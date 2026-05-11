const express = require('express');
const http = require('http');
const app = express();
require('dotenv').config();

const { connectToDatabase, closeDatabase } = require('./db');
const { initializeSocket } = require('./socket/index');

const helmet = require('helmet');
const compression = require('compression');
const config = require('config');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

// Create HTTP server for Socket.IO
const server = http.createServer(app);

// Initialize Socket.IO and attach to app for use in routes
const io = initializeSocket(server);
app.set('io', io);

// Enable CORS for all routes
app.use(cors({ origin: '*' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(helmet());
app.use(compression());
app.use(bodyParser.json());

async function startServer() {
  // Connect to MongoDB FIRST — single shared connection
  const db = await connectToDatabase();

  // Mount routes — pass db to factory functions
  app.use('/api/categories', require('./routes/categories')(db));
  app.use('/api/listing', require('./routes/listing')(db));
  app.use('/api/listings', require('./routes/listings')(db));
  app.use('/api/user', require('./routes/user')(db));
  app.use('/api/users', require('./routes/users')(db));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/blog', require('./routes/blog')(db));
  app.use('/api/my', require('./routes/my'));
  app.use('/api/expoPushTokens', require('./routes/expoPushTokens'));
  app.use('/api/messages', require('./routes/messages'));
  app.use('/api/image', require('./routes/image')(db));
  app.use('/api/blogImage', require('./routes/blogImage'));
  app.use('/api/contact', require('./routes/contact'));
  app.use('/api/trickipedia', require('./routes/trickipedia')(db));
  app.use('/api/trickImage', require('./routes/trickImage'));
  app.use('/api/spots', require('./routes/spots')(db));
  app.use('/api/spotlists', require('./routes/spotlists')(db));
  app.use('/api/payments', require('./routes/payments')(db));
  app.use('/api/media', require('./routes/media')(db));
  app.use('/api/feed', require('./routes/feed')(db));
  app.use('/api/upload', require('./routes/upload'));
  app.use('/api/dm', require('./routes/dm')(db));
  app.use('/api/companion', require('./routes/companionProfile')(db));
  app.use('/api/couch', require('./routes/couch')(db));
  app.use('/api/spot-reviews', require('./routes/spotReviews')(db));
  app.use('/api/newsletter', require('./routes/newsletter')(db));
  app.use('/api/bot-chat', require('./routes/botChat')(db));
  app.use('/api/spot-tricks', require('./routes/spotTrickHistory')(db));
  app.use('/api/stats', require('./routes/stats')(db));
  app.use('/api/analytics', require('./routes/analytics')(db));

  const port = process.env.PORT || config.get('port');
  server.listen(port, () => {
    console.log(`Server started on port ${port}...`);
    console.log(`Socket.IO listening for connections`);
  });
}

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
