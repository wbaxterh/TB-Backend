const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const authAdmin = () => {
  return (req, res, next) => {
    let token = req.header('x-auth-token');
    // Check if the token is undefined or empty
    if (!token || typeof token !== 'string') {
      return res.status(401).send({ error: 'Access denied. No token provided.' });
    }

    token = token.trim();

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      const db = require('../db').getDb();
      const usersCollection = db.collection('users');
      usersCollection.findOne({ _id: ObjectId(req.user.userId) }, (err, user) => {
        if (err) return res.status(500).send('Error verifying user.');
        if (!user) return res.status(400).send('User not found.');

        if (user.role !== 'admin') {
          return res.status(403).send('Access denied. Admins only.');
        }

        next();
      });
    } catch (_err) {
      res.status(400).send({ error: 'Invalid token.' });
    }
  };
};

module.exports = authAdmin;
