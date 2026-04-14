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
let userCooldowns = new Map();

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

io.on('connection', (socket) => {
    // Send full state on join
    socket.emit('init', { grid, counts, totalChanges });
    io.emit('userCount', io.engine.clientsCount);

    socket.on('changeSquare', ({ index, color }) => {
        const now = Date.now();
        const lastMove = userCooldowns.get(socket.id) || 0;

        if (now - lastMove < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - (now - lastMove)) / 1000);
            socket.emit('error', `Wait ${remaining}s`);
            return;
        }

        if (index >= 0 && index < grid.length) {
            grid[index] = color;
            counts[index]++;
            totalChanges++;
            userCooldowns.set(socket.id, now);

            io.emit('update', { index, color, count: counts[index], totalChanges });
        }
    });

    socket.on('disconnect', () => io.emit('userCount', io.engine.clientsCount));
});

server.listen(3000, () => console.log('Canvas server running on port 3000'));