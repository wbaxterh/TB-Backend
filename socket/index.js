const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const setupFeedSocket = require('./feedSocket');
const setupMessageSocket = require('./messageSocket');

/**
 * Initialize Socket.IO server with JWT authentication
 * @param {http.Server} server - HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // JWT Authentication middleware for all connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      // Allow connection without auth for public features
      // but mark as unauthenticated
      socket.userId = null;
      socket.authenticated = false;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.authenticated = true;
      next();
    } catch (err) {
      console.error('Socket auth error:', err.message);
      // Allow connection but mark as unauthenticated
      socket.userId = null;
      socket.authenticated = false;
      next();
    }
  });

  // Main namespace connection handler
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId || 'anonymous'})`);

    // Join user's personal room if authenticated
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (error) => {
      console.error(`Socket error: ${socket.id}`, error);
    });
  });

  // Setup namespaces
  setupFeedSocket(io);
  setupMessageSocket(io);

  console.log('Socket.IO initialized with /feed and /messages namespaces');

  return io;
};

module.exports = { initializeSocket };
