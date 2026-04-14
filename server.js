const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_SIZE = 100;
const COOLDOWN_MS = 60000; // 1 minute

// Initialize State
let grid = Array(GRID_SIZE * GRID_SIZE).fill('#ffffff');
let counts = Array(GRID_SIZE * GRID_SIZE).fill(0);
let totalChanges = 0;
let userCooldowns = new Map();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    // 1. Send initial data to the new user
    socket.emit('init', { grid, counts, totalChanges });
    io.emit('userCount', io.engine.clientsCount);

    // 2. Handle color change attempts
    socket.on('changeSquare', ({ index, color }) => {
        const lastMove = userCooldowns.get(socket.id) || 0;
        const now = Date.now();

        if (now - lastMove < COOLDOWN_MS) {
            socket.emit('error', 'Wait for the cooldown!');
            return;
        }

        // Update state
        grid[index] = color;
        counts[index]++;
        totalChanges++;
        userCooldowns.set(socket.id, now);

        // Broadcast change to everyone
        io.emit('update', { index, color, count: counts[index], totalChanges });
    });

    socket.on('disconnect', () => {
        io.emit('userCount', io.engine.clientsCount);
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));