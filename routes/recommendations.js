const express = require('express');
const auth = require('../middleware/auth');
const authAdmin = require('../middleware/authAdmin');
const { createGraphClient } = require('../services/graph/client');
const { graphRecommendations, mongoRecommendations } = require('../services/graph/recommendations');

module.exports = (db, options = {}) => {
  const router = express.Router();
  const graph = options.graph || createGraphClient();

  router.get('/progression', auth, async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 5));
    const sport = String(req.query.sport || '')
      .trim()
      .toLowerCase();
    if (graph.enabled) {
      try {
        const items = await graphRecommendations(graph, req.user.userId, sport, limit);
        if (items.length) return res.json({ items, source: 'neo4j' });
      } catch (error) {
        console.error('[graph] recommendation fallback:', error.message);
      }
    }
    try {
      const items = await mongoRecommendations(db, req.user.userId, sport, limit);
      return res.json({ items, source: 'mongo-fallback' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Unable to build progression recommendations' });
    }
  });

  router.get('/graph-health', authAdmin(), async (_req, res) => {
    const outbox = db.collection('graph_outbox');
    const [pending, dead, oldest] = await Promise.all([
      outbox.countDocuments({ status: 'pending' }),
      outbox.countDocuments({ status: 'dead' }),
      outbox.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(1).toArray(),
    ]);
    let reachable = false;
    if (graph.enabled) {
      try {
        await graph.run('RETURN 1');
        reachable = true;
      } catch (_error) {
        reachable = false;
      }
    }
    res.status(graph.enabled && !reachable ? 503 : 200).json({
      enabled: graph.enabled,
      reachable,
      pending,
      dead,
      oldestPendingAt: oldest[0]?.createdAt || null,
    });
  });

  return router;
};
