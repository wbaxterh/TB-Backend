const express = require('express');

let cachedStats = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

module.exports = (db) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const now = Date.now();
    if (cachedStats && now - cacheTimestamp < CACHE_TTL) {
      return res.json(cachedStats);
    }

    try {
      const [spots, tricks, trickLists, users, trickipedia] = await Promise.all([
        db.collection('spots').countDocuments(),
        db.collection('tricks').countDocuments(),
        db.collection('tricklists').countDocuments(),
        db.collection('users').countDocuments(),
        db.collection('trickipedia').countDocuments(),
      ]);

      cachedStats = { spots, tricks, trickLists, users, trickipedia };
      cacheTimestamp = now;

      res.json(cachedStats);
    } catch (error) {
      console.error('Stats endpoint error:', error.message);
      if (cachedStats) {
        return res.json(cachedStats);
      }
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  return router;
};
