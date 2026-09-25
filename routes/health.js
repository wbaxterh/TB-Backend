const express = require('express');
const pkg = require('../package.json');

const DB_PING_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Unauthenticated liveness and readiness probe. It reports nothing an attacker can
// use (no hostnames, env, or dependency versions), so it is safe to leave public.
module.exports = (db, options = {}) => {
  const version = options.version || process.env.APP_VERSION || pkg.version;
  const pingTimeoutMs = options.pingTimeoutMs || DB_PING_TIMEOUT_MS;
  const router = express.Router();

  router.get('/', async (_req, res) => {
    const startedAt = Date.now();
    let dbStatus = 'ok';
    try {
      await withTimeout(db.command({ ping: 1 }), pingTimeoutMs);
    } catch {
      dbStatus = 'error';
    }
    const healthy = dbStatus === 'ok';
    res.set('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      version,
      uptimeSeconds: Math.round(process.uptime()),
      db: dbStatus,
      dbLatencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
};
