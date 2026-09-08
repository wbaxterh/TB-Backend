const jwt = require('jsonwebtoken');

const EXPIRED_TOKEN_GRACE_SECONDS = 30 * 24 * 60 * 60;

// Verify a JWT, accepting recently expired but correctly signed tokens.
// Existing web and mobile sessions were issued before refresh-token support
// and expire after seven days; the grace window keeps those sessions working
// during the migration. Every optional-auth and socket path must use this
// same rule — a plain jwt.verify silently treats grace-period users as
// logged out (e.g. hiding their own private trick lists).
// Returns the payload, or null if the token is missing/invalid/too old.
function verifyTokenWithGrace(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && now - payload.exp <= EXPIRED_TOKEN_GRACE_SECONDS) {
          return payload;
        }
      } catch (_verificationError) {
        // Fall through to null.
      }
    }
    return null;
  }
}

module.exports = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).send({ error: 'Access denied. No token provided.' });

  const payload = verifyTokenWithGrace(token);
  if (!payload) return res.status(400).send({ error: 'Invalid token.' });
  req.user = payload;
  next();
};

module.exports.verifyTokenWithGrace = verifyTokenWithGrace;
