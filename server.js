const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const config = require('./src/config');
const { getDb } = require('./src/db');
const { requireAuth, requirePermission } = require('./src/middleware/auth');
const playerService = require('./src/services/PlayerService');
const schedulerService = require('./src/services/SchedulerService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Session setup
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(sessionMiddleware);

// Initialize database
getDb();

// Auth routes (login page + login/logout API) — no auth required
app.use(require('./src/routes/auth'));

// Server restart endpoint (before api router)
app.post('/api/server/restart', requireAuth, requirePermission('server_restart'), (req, res) => {
  res.json({ success: true, message: 'Server restarting...' });
  setTimeout(() => {
    console.log('Restarting server...');
    process.exit(0); // systemd or pm2 will restart the process
  }, 500);
});

// Expose io for routes that need to emit events
app.set('io', io);

// Protect all other routes
app.use('/api', requireAuth, require('./src/routes/api'));

// Serve static files (protected — redirect to login if not authenticated)
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  // Allow static assets (CSS/JS) to load on login page
  if (req.path.match(/\.(css|js|ico|png|svg|woff2?)$/)) {
    return next();
  }
  return res.redirect('/login');
}, express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // JS/CSS: short cache, must revalidate (cache-busting via ?v= query)
    if (filePath.match(/\.(js|css)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    }
  },
}));

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO — share session + broadcast player state
io.engine.use(sessionMiddleware);

playerService.on('stateChange', (state) => {
  io.emit('playerState', state);
});

io.on('connection', (socket) => {
  socket.emit('playerState', playerService.getState());
});

// Start
async function start() {
  await playerService.init();
  schedulerService.start();

  server.listen(config.port, () => {
    console.log(`Store Music Manager running at http://localhost:${config.port}`);
    console.log('Default login: admin / admin');
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
