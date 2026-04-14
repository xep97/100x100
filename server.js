const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_SIZE = 100;
const COOLDOWN_MS = 60000;

// State management
let grid = Array(GRID_SIZE * GRID_SIZE).fill('#ffffff');
let counts = Array(GRID_SIZE * GRID_SIZE).fill(0);
let totalChanges = 0;
let ipCooldowns = new Map(); // Tracking by IP now

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

io.on('connection', (socket) => {
    const userIP = socket.handshake.address;

    // Send initial state and current user's specific cooldown
    const lastMove = ipCooldowns.get(userIP) || 0;
    const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastMove));
    
    socket.emit('init', { 
        grid, 
        counts, 
        totalChanges, 
        cooldownRemaining: remaining 
    });

    io.emit('userCount', io.engine.clientsCount);

    socket.on('changeSquare', ({ index, color }) => {
        const now = Date.now();
        const lastMove = ipCooldowns.get(userIP) || 0;

        if (now - lastMove < COOLDOWN_MS) {
            socket.emit('error', 'Cooldown active');
            return;
        }

        if (index >= 0 && index < grid.length) {
            grid[index] = color;
            counts[index]++;
            totalChanges++;
            ipCooldowns.set(userIP, now); // Update the IP map

            // Broadcast the change and the 60s cooldown to the specific user
            io.emit('update', { index, color, count: counts[index], totalChanges });
            socket.emit('startTimer', COOLDOWN_MS);
        }
    });

    socket.on('disconnect', () => io.emit('userCount', io.engine.clientsCount));
});

server.listen(3000, () => console.log('Secure Canvas server running...'));