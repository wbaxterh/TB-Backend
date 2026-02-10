const express = require('express');
const http = require('http');
const app = express();
require('dotenv').config();

// Socket.IO setup - use socket/index.js which has namespaces for feed and messages
const { initializeSocket } = require('./socket/index');

const categories = require('./routes/categories');
const listings = require('./routes/listings');
const listing = require('./routes/listing');
const users = require('./routes/users');
const user = require('./routes/user');
const auth = require('./routes/auth');
// const googleSSO = require("./routes/auth");
const image = require('./routes/image');
const my = require('./routes/my');
const blog = require('./routes/blog');
const blogImage = require('./routes/blogImage');
const messages = require('./routes/messages');
const contact = require('./routes/contact');
const expoPushTokens = require('./routes/expoPushTokens');
const helmet = require('helmet');
const compression = require('compression');
const config = require('config');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const trickipedia = require('./routes/trickipedia');
const trickImage = require('./routes/trickImage');
const spots = require('./routes/spots');
const spotlists = require('./routes/spotlists');
const payments = require('./routes/payments');
const media = require('./routes/media');
const feed = require('./routes/feed');
const upload = require('./routes/upload');
const dm = require('./routes/dm');
const couch = require('./routes/couch');
const spotReviews = require('./routes/spotReviews');
const newsletter = require('./routes/newsletter');

// Create HTTP server for Socket.IO
const server = http.createServer(app);

// Initialize Socket.IO and attach to app for use in routes
const io = initializeSocket(server);
app.set('io', io);

// Enable CORS for all routes
app.use(
  cors({
    origin: '*', // Allows all origins
    // For development, you might use '*' to allow all origins
  }),
);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(helmet());
app.use(compression());
app.use(bodyParser.json());

app.use('/api/categories', categories);
app.use('/api/listing', listing);
app.use('/api/listings', listings);
app.use('/api/user', user);
app.use('/api/users', users);
app.use('/api/auth', auth);
app.use('/api/blog', blog);
app.use('/api/my', my);
app.use('/api/expoPushTokens', expoPushTokens);
app.use('/api/messages', messages);
app.use('/api/image', image);
app.use('/api/blogImage', blogImage);
app.use('/api/contact', contact);
app.use('/api/trickipedia', trickipedia);
app.use('/api/trickImage', trickImage);
app.use('/api/spots', spots);
app.use('/api/spotlists', spotlists);
app.use('/api/payments', payments);
app.use('/api/media', media);
app.use('/api/feed', feed);
app.use('/api/upload', upload);
app.use('/api/dm', dm);
app.use('/api/couch', couch);
app.use('/api/spot-reviews', spotReviews);
app.use('/api/newsletter', newsletter);

const port = process.env.PORT || config.get('port');
server.listen(port, () => {
  console.log(`Server started on port ${port}...`);
  console.log(`Socket.IO listening for connections`);
});
