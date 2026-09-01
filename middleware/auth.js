const jwt = require('jsonwebtoken');

const EXPIRED_TOKEN_GRACE_SECONDS = 30 * 24 * 60 * 60;

module.exports = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).send({ error: 'Access denied. No token provided.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    // Existing web and mobile sessions were issued before refresh-token support
    // and expire after seven days. Keep recently expired, correctly signed tokens
    // working during the migration instead of rendering Homies/messages empty.
    if (err?.name === 'TokenExpiredError') {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && now - payload.exp <= EXPIRED_TOKEN_GRACE_SECONDS) {
          req.user = payload;
          return next();
        }
      } catch (_verificationError) {
        // Fall through to the normal invalid-token response.
      }
    }
    res.status(400).send({ error: 'Invalid token.' });
  }
};
