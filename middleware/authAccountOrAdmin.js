const jwt = require('jsonwebtoken');

// Allow the request only if the caller is an admin OR is acting on their own
// account (:id === their own userId). Reads the same x-auth-token header every
// other client sends. Previously this read the Authorization header (which no
// client sends, so it threw and 401'd every request) AND fell back to matching
// req.body.email, which let any authenticated user delete any account by
// putting the target's email in the body — that bypass is removed.
function authAccountOrAdmin() {
  return (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).send({ error: 'Access denied. No token provided.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_err) {
      return res.status(400).send({ error: 'Invalid token.' });
    }

    req.user = payload;
    if (payload.role === 'admin' || payload.userId === req.params.id) {
      return next();
    }
    return res.status(403).send({ error: 'Access denied.' });
  };
}

module.exports = authAccountOrAdmin;
