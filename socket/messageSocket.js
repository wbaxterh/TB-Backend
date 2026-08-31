const jwt = require('jsonwebtoken');

/**
 * Setup the /messages namespace for real-time direct messaging
 * @param {Server} io - Socket.IO server instance
 */
const setupMessageSocket = (io) => {
  const messagesNamespace = io.of('/messages');

  // JWT Authentication middleware - required for messages
  messagesNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication required for messaging'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.authenticated = true;
      next();
    } catch (_err) {
      return next(new Error('Invalid authentication token'));
    }
  });

  messagesNamespace.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`[Messages] Socket connected: ${socket.id} (user: ${userId})`);

    // Auto-join user's personal room for receiving messages
    socket.join(`user:${userId}`);
    console.log(`[Messages] ${socket.id} joined personal room: user:${userId}`);

    // Join a specific conversation room for typing indicators and real-time messages
    socket.on('join:conversation', (conversationId) => {
      if (conversationId) {
        socket.join(`conversation:${conversationId}`);
        console.log(`[Messages] ${socket.id} joined conversation:${conversationId}`);
        // Log all rooms this socket is now in
        console.log(`[Messages] ${socket.id} is now in rooms:`, Array.from(socket.rooms));
      }
    });

    // Leave a conversation room
    socket.on('leave:conversation', (conversationId) => {
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
        console.log(`[Messages] ${socket.id} left conversation:${conversationId}`);
      }
    });

    // Typing indicator - start
    socket.on('typing:start', ({ conversationId }) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:start', {
          conversationId,
          userId,
        });
      }
    });

    // Typing indicator - stop
    socket.on('typing:stop', ({ conversationId }) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:stop', {
          conversationId,
          userId,
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Messages] Socket disconnected: ${socket.id}`);
    });
  });

  return messagesNamespace;
};

/**
 * Emit a new message event to the recipient and the conversation room
 * @param {Server} io - Socket.IO server instance
 * @param {string} recipientId - The recipient user ID
 * @param {Object} message - The message data
 * @param {Object} conversation - The conversation data
 */
const emitNewMessage = (io, recipientId, message, conversation) => {
  const messagesNs = io.of('/messages');

  // Emit to recipient's personal room (for notifications/badge updates)
  messagesNs.to(`user:${recipientId}`).emit('message:new', {
    message,
    conversation,
  });

  // Also emit to the conversation room (for real-time chat updates)
  // This ensures both users with the conversation open see the message
  messagesNs.to(`conversation:${message.conversationId}`).emit('message:new', {
    message,
    conversation,
  });

  console.log(
    `[Messages] Emitted message:new to user:${recipientId} and conversation:${message.conversationId}`,
  );
};

/**
 * Emit a new message to MANY recipients (group chats) + the conversation room.
 * Emits `message:new` once per recipient personal room and once to the shared
 * conversation room. Clients must dedupe by message._id (a participant with the
 * thread open is in both rooms).
 * @param {Server} io - Socket.IO server instance
 * @param {string[]} recipientIds - Every participant except the sender
 * @param {Object} message - The message data
 * @param {Object} conversation - The conversation data
 */
const emitNewMessageToRecipients = (io, recipientIds, message, conversation) => {
  const messagesNs = io.of('/messages');
  (recipientIds || []).forEach((rid) => {
    messagesNs.to(`user:${rid}`).emit('message:new', { message, conversation });
  });
  messagesNs.to(`conversation:${message.conversationId}`).emit('message:new', {
    message,
    conversation,
  });
  console.log(
    `[Messages] Emitted message:new to ${(recipientIds || []).length} recipient(s) + conversation:${message.conversationId}`,
  );
};

/**
 * Emit a messages read event to the sender
 * @param {Server} io - Socket.IO server instance
 * @param {string} senderId - The original sender's user ID
 * @param {string} conversationId - The conversation ID
 * @param {string} readBy - The user ID who read the messages
 */
const emitMessagesRead = (io, senderId, conversationId, readBy) => {
  io.of('/messages').to(`user:${senderId}`).emit('messages:read', {
    conversationId,
    readBy,
  });
};

module.exports = setupMessageSocket;
module.exports.emitNewMessage = emitNewMessage;
module.exports.emitNewMessageToRecipients = emitNewMessageToRecipients;
module.exports.emitMessagesRead = emitMessagesRead;
