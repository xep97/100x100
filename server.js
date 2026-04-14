require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const GRID_SIZE = 100;
const COOLDOWN_MS = 60000; // 1 minute

// The 16 allowed colors (EGA Palette)
const ALLOWED_COLORS = [
    "#000000", "#FFFFFF", "#FF0000", "#00FF00", 
    "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
    "#800000", "#008000", "#000080", "#808000",
    "#800080", "#008080", "#808080", "#C0C0C0"
];

// --- SUPABASE SETUP ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Local State (Mirrors the DB for instant performance)
let grid = [];
let counts = [];
let totalChanges = 0;
const ipCooldowns = new Map();

// Load data from Supabase on startup
async function loadInitialData() {
    try {
        const { data, error } = await supabase
            .from('canvas_state')
            .select('*')
            .eq('id', 1)
            .single();
        
        if (error) throw error;

        grid = data.grid;
        counts = data.counts;
        totalChanges = data.total_changes;
        console.log("✅ State successfully synchronized with Supabase");
    } catch (err) {
        console.error("❌ Database sync error:", err.message);
        // Fallback to empty state if DB fails so server still runs
        grid = Array(GRID_SIZE * GRID_SIZE).fill('#FFFFFF');
        counts = Array(GRID_SIZE * GRID_SIZE).fill(0);
    }
}
loadInitialData();

// Serve the frontend
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    // Detect real IP even behind Render's proxy
    const userIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    // Check if this IP is currently on cooldown
    const lastMove = ipCooldowns.get(userIP) || 0;
    const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastMove));

    // Send the full current world state to the new user
    socket.emit('init', { 
        grid, 
        counts, 
        totalChanges, 
        cooldownRemaining: remaining 
    });

    // Update the online user count for everyone
    io.emit('userCount', io.engine.clientsCount);

    socket.on('changeSquare', async ({ index, color }) => {
        const now = Date.now();
        const lastMove = ipCooldowns.get(userIP) || 0;

        // 1. Verify Cooldown
        if (now - lastMove < COOLDOWN_MS) {
            return socket.emit('error', 'Cooldown is still active.');
        }

        // 2. Validate Color (Security)
        if (!ALLOWED_COLORS.includes(color.toUpperCase())) {
            return socket.emit('error', 'Invalid color selection.');
        }

        // 3. Validate Index
        if (index < 0 || index >= grid.length) return;

        // 4. Update Local Memory (Instant)
        grid[index] = color;
        counts[index]++;
        totalChanges++;
        ipCooldowns.set(userIP, now);

        // 5. Broadcast to all clients (Real-time UI update)
        io.emit('update', { index, color, count: counts[index], totalChanges });
        
        // 6. Confirm cooldown to the specific user
        socket.emit('startTimer', COOLDOWN_MS);

        // 7. Persist to Supabase (Background)
        const { error } = await supabase
            .from('canvas_state')
            .update({ 
                grid: grid, 
                counts: counts, 
                total_changes: totalChanges 
            })
            .eq('id', 1);
        
        if (error) console.error("⚠️ Failed to save to Supabase:", error.message);
    });

    socket.on('disconnect', () => {
        io.emit('userCount', io.engine.clientsCount);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});