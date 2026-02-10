const jwt = require('jsonwebtoken');

/**
 * Setup the /feed namespace for real-time comment updates
 * @param {Server} io - Socket.IO server instance
 */
const setupFeedSocket = (io) => {
  const feedNamespace = io.of('/feed');

  // JWT Authentication middleware for feed namespace
  feedNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      socket.userId = null;
      socket.authenticated = false;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.authenticated = true;
      next();
    } catch (_err) {
      socket.userId = null;
      socket.authenticated = false;
      next();
    }
  });

  feedNamespace.on('connection', (socket) => {
    console.log(`[Feed] Socket connected: ${socket.id} (user: ${socket.userId || 'anonymous'})`);

    // Join a post's room to receive real-time comment updates
    socket.on('join:post', (postId) => {
      if (postId) {
        socket.join(`post:${postId}`);
        console.log(`[Feed] ${socket.id} joined post:${postId}`);
      }
    });

    // Leave a post's room
    socket.on('leave:post', (postId) => {
      if (postId) {
        socket.leave(`post:${postId}`);
        console.log(`[Feed] ${socket.id} left post:${postId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Feed] Socket disconnected: ${socket.id}`);
    });
  });

  return feedNamespace;
};

/**
 * Emit a new comment event to all clients watching a post
 * @param {Server} io - Socket.IO server instance
 * @param {string} postId - The post ID
 * @param {Object} comment - The comment data with user info populated
 */
const emitNewComment = (io, postId, comment) => {
  io.of('/feed').to(`post:${postId}`).emit('comment:new', comment);
};

/**
 * Emit a comment deleted event to all clients watching a post
 * @param {Server} io - Socket.IO server instance
 * @param {string} postId - The post ID
 * @param {string} commentId - The deleted comment ID
 */
const emitCommentDeleted = (io, postId, commentId) => {
  io.of('/feed').to(`post:${postId}`).emit('comment:deleted', { commentId });
};

/**
 * Emit a comment loved event to all clients watching a post
 * @param {Server} io - Socket.IO server instance
 * @param {string} postId - The post ID
 * @param {string} commentId - The comment ID
 * @param {number} loveCount - The new love count
 */
const emitCommentLoved = (io, postId, commentId, loveCount) => {
  io.of('/feed').to(`post:${postId}`).emit('comment:loved', { commentId, loveCount });
};

module.exports = setupFeedSocket;
module.exports.emitNewComment = emitNewComment;
module.exports.emitCommentDeleted = emitCommentDeleted;
module.exports.emitCommentLoved = emitCommentLoved;
