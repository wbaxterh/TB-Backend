const express = require('express');
const router = express.Router();
const { MongoClient } = require('mongodb');
const authAdmin = require('../middleware/authAdmin');
const connectionString = process.env.ATLAS_URI;

let eventsCollection;

MongoClient.connect(connectionString)
  .then((client) => {
    const db = client.db('TrickList2');
    eventsCollection = db.collection('analytics_events');

    // Create indexes for fast querying
    eventsCollection.createIndex({ event: 1, timestamp: -1 });
    eventsCollection.createIndex({ timestamp: -1 });
    eventsCollection.createIndex({ sessionId: 1 });
    eventsCollection.createIndex({ userId: 1 });

    console.log('Analytics: Connected to MongoDB');
  })
  .catch((err) => console.error('Analytics DB error:', err));

// ============================================
// PUBLIC: Receive events from frontend
// ============================================
router.post('/events', async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const { event, properties, sessionId, userId, url, referrer, userAgent } = req.body;

    if (!event) return res.status(400).json({ error: 'event is required' });

    await eventsCollection.insertOne({
      event,
      properties: properties || {},
      sessionId: sessionId || null,
      userId: userId || null,
      url: url || null,
      referrer: referrer || null,
      userAgent: userAgent || null,
      timestamp: new Date(),
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error('Analytics insert error:', error.message);
    res.status(500).json({ error: 'Failed to store event' });
  }
});

// Batch insert events
router.post('/events/batch', async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events array is required' });
    }

    const docs = events.map((e) => ({
      event: e.event,
      properties: e.properties || {},
      sessionId: e.sessionId || null,
      userId: e.userId || null,
      url: e.url || null,
      referrer: e.referrer || null,
      userAgent: e.userAgent || null,
      timestamp: new Date(e.timestamp || Date.now()),
    }));

    await eventsCollection.insertMany(docs);
    res.status(201).json({ ok: true, count: docs.length });
  } catch (error) {
    console.error('Analytics batch insert error:', error.message);
    res.status(500).json({ error: 'Failed to store events' });
  }
});

// ============================================
// ADMIN: Dashboard aggregation endpoints
// ============================================

// Overview stats for a date range
router.get('/dashboard/overview', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalEvents, uniqueSessions, uniqueUsers, pageviews, ctaClicks, appStoreClicks] =
      await Promise.all([
        eventsCollection.countDocuments({ timestamp: { $gte: since } }),
        eventsCollection
          .distinct('sessionId', { timestamp: { $gte: since }, sessionId: { $ne: null } })
          .then((s) => s.length),
        eventsCollection
          .distinct('userId', { timestamp: { $gte: since }, userId: { $ne: null } })
          .then((u) => u.length),
        eventsCollection.countDocuments({ event: '$pageview', timestamp: { $gte: since } }),
        eventsCollection.countDocuments({ event: 'cta_clicked', timestamp: { $gte: since } }),
        eventsCollection.countDocuments({ event: 'app_store_clicked', timestamp: { $gte: since } }),
      ]);

    res.json({
      days,
      totalEvents,
      uniqueSessions,
      uniqueUsers,
      pageviews,
      ctaClicks,
      appStoreClicks,
    });
  } catch (error) {
    console.error('Dashboard overview error:', error.message);
    res.status(500).json({ error: 'Failed to get overview' });
  }
});

// Traffic over time (pageviews per day)
router.get('/dashboard/traffic', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: '$pageview', timestamp: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          pageviews: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          pageviews: 1,
          uniqueVisitors: { $size: '$uniqueSessions' },
        },
      },
      { $sort: { date: 1 } },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('Traffic error:', error.message);
    res.status(500).json({ error: 'Failed to get traffic' });
  }
});

// Top pages
router.get('/dashboard/pages', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: '$pageview', timestamp: { $gte: since }, url: { $ne: null } } },
      {
        $group: {
          _id: '$url',
          views: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          page: '$_id',
          views: 1,
          uniqueVisitors: { $size: '$uniqueSessions' },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 20 },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('Pages error:', error.message);
    res.status(500).json({ error: 'Failed to get pages' });
  }
});

// Landing page section engagement
router.get('/dashboard/sections', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: 'landing_section_viewed', timestamp: { $gte: since } } },
      {
        $group: {
          _id: '$properties.section',
          views: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          section: '$_id',
          views: 1,
          uniqueVisitors: { $size: '$uniqueSessions' },
        },
      },
      { $sort: { views: -1 } },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('Sections error:', error.message);
    res.status(500).json({ error: 'Failed to get sections' });
  }
});

// Scroll depth distribution
router.get('/dashboard/scroll-depth', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: 'landing_scroll_depth', timestamp: { $gte: since } } },
      {
        $group: {
          _id: '$properties.depth_percent',
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          depth: '$_id',
          count: 1,
        },
      },
      { $sort: { depth: 1 } },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('Scroll depth error:', error.message);
    res.status(500).json({ error: 'Failed to get scroll depth' });
  }
});

// CTA performance
router.get('/dashboard/ctas', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: 'cta_clicked', timestamp: { $gte: since } } },
      {
        $group: {
          _id: { name: '$properties.cta_name', location: '$properties.cta_location' },
          clicks: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          ctaName: '$_id.name',
          location: '$_id.location',
          clicks: 1,
          uniqueClickers: { $size: '$uniqueSessions' },
        },
      },
      { $sort: { clicks: -1 } },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('CTAs error:', error.message);
    res.status(500).json({ error: 'Failed to get CTAs' });
  }
});

// App store clicks breakdown
router.get('/dashboard/app-stores', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { event: 'app_store_clicked', timestamp: { $gte: since } } },
      {
        $group: {
          _id: { store: '$properties.store', location: '$properties.cta_location' },
          clicks: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          store: '$_id.store',
          location: '$_id.location',
          clicks: 1,
        },
      },
      { $sort: { clicks: -1 } },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('App stores error:', error.message);
    res.status(500).json({ error: 'Failed to get app store data' });
  }
});

// Conversion funnel
router.get('/dashboard/funnel', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [landingViews, scrolledPast50, ctaClicks, appStoreClicks, signupStarts, signupCompletes] =
      await Promise.all([
        eventsCollection.countDocuments({
          event: 'landing_section_viewed',
          'properties.section': 'hero',
          timestamp: { $gte: since },
        }),
        eventsCollection.countDocuments({
          event: 'landing_scroll_depth',
          'properties.depth_percent': { $gte: 50 },
          timestamp: { $gte: since },
        }),
        eventsCollection.countDocuments({ event: 'cta_clicked', timestamp: { $gte: since } }),
        eventsCollection.countDocuments({ event: 'app_store_clicked', timestamp: { $gte: since } }),
        eventsCollection.countDocuments({ event: 'signup_started', timestamp: { $gte: since } }),
        eventsCollection.countDocuments({ event: 'signup_completed', timestamp: { $gte: since } }),
      ]);

    res.json({
      steps: [
        { name: 'Landed on page', count: landingViews },
        { name: 'Scrolled 50%+', count: scrolledPast50 },
        { name: 'Clicked a CTA', count: ctaClicks },
        { name: 'Clicked App Store', count: appStoreClicks },
        { name: 'Started signup', count: signupStarts },
        { name: 'Completed signup', count: signupCompletes },
      ],
    });
  } catch (error) {
    console.error('Funnel error:', error.message);
    res.status(500).json({ error: 'Failed to get funnel' });
  }
});

// Referrer breakdown
router.get('/dashboard/referrers', [authAdmin()], async (req, res) => {
  if (!eventsCollection) return res.status(503).json({ error: 'Not ready' });

  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      {
        $match: { event: '$pageview', timestamp: { $gte: since }, referrer: { $nin: [null, ''] } },
      },
      {
        $group: {
          _id: '$referrer',
          visits: { $sum: 1 },
          uniqueSessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          referrer: '$_id',
          visits: 1,
          uniqueVisitors: { $size: '$uniqueSessions' },
        },
      },
      { $sort: { visits: -1 } },
      { $limit: 15 },
    ];

    const data = await eventsCollection.aggregate(pipeline).toArray();
    res.json(data);
  } catch (error) {
    console.error('Referrers error:', error.message);
    res.status(500).json({ error: 'Failed to get referrers' });
  }
});

module.exports = router;
