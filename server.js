require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- SUPABASE CONFIG ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let grid = [];
let counts = [];
let totalChanges = 0;
const ipCooldowns = new Map();

// Load data from Supabase once when the server starts
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
        console.log("✅ Data loaded from Supabase");
    } catch (err) {
        console.error("❌ Failed to load data:", err.message);
    }
}
loadInitialData();

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

io.on('connection', (socket) => {
    // Render uses a proxy, so we check x-forwarded-for for the real IP
    const userIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    const lastMove = ipCooldowns.get(userIP) || 0;
    const remaining = Math.max(0, 60000 - (Date.now() - lastMove));

    socket.emit('init', { grid, counts, totalChanges, cooldownRemaining: remaining });
    io.emit('userCount', io.engine.clientsCount);

    socket.on('changeSquare', async ({ index, color }) => {
        const now = Date.now();
        const lastMove = ipCooldowns.get(userIP) || 0;

        if (now - lastMove < 60000) return;

        // 1. Update local memory (Instant response)
        grid[index] = color;
        counts[index]++;
        totalChanges++;
        ipCooldowns.set(userIP, now);

        // 2. Tell everyone (Real-time)
        io.emit('update', { index, color, count: counts[index], totalChanges });
        socket.emit('startTimer', 60000);

        // 3. Update Supabase (Background)
        const { error } = await supabase
            .from('canvas_state')
            .update({ grid, counts, total_changes: totalChanges })
            .eq('id', 1);
        
        if (error) console.error("Database sync error:", error.message);
    });

    socket.on('disconnect', () => io.emit('userCount', io.engine.clientsCount));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));