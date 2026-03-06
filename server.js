const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./src/config');
const { getDb } = require('./src/db');
const playerService = require('./src/services/PlayerService');
const schedulerService = require('./src/services/SchedulerService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
getDb();

// API routes
app.use('/api', require('./src/routes/api'));

// Socket.IO — broadcast player state changes
playerService.on('stateChange', (state) => {
  io.emit('playerState', state);
});

io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('playerState', playerService.getState());
});

// Start
async function start() {
  await playerService.init();
  schedulerService.start();

  server.listen(config.port, () => {
    console.log(`Store Music Manager running at http://localhost:${config.port}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  schedulerService.stop();
  try { await playerService.stop(); } catch {}
  process.exit(0);
});
