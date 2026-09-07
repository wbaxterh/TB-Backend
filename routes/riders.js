const express = require('express');
const { ObjectId } = require('mongodb');
const { PUBLIC_RIDER_PROJECTION, SUPPORTED_SPORTS } = require('../services/riders/editorialRider');
const escapeRegex = require('../utils/escapeRegex');

const RIDER_PROJECTION = {
  name: 1,
  imageUri: 1,
  sports: 1,
  bio: 1,
  riderProfile: 1,
  createdAt: 1,
};

module.exports = (db) => {
  const router = express.Router();
  const users = db.collection('users');
  const editorialRiders = db.collection('riders');

  router.get('/editorial', async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
      const query = String(req.query.q || '')
        .trim()
        .slice(0, 80);
      const sport = String(req.query.sport || '')
        .trim()
        .toLowerCase()
        .slice(0, 40);

      if (sport && !SUPPORTED_SPORTS.has(sport)) {
        return res.status(400).send({ error: 'Invalid sport' });
      }

      const filter = { reviewStatus: 'published' };
      if (sport) filter.primarySport = sport;
      if (query) {
        const safeQuery = { $regex: escapeRegex(query), $options: 'i' };
        filter.$or = [
          { canonicalName: safeQuery },
          { aliases: safeQuery },
          { biography: safeQuery },
          { nationality: safeQuery },
          { homeRegion: safeQuery },
          { sponsors: safeQuery },
          { teams: safeQuery },
        ];
      }

      const [items, total] = await Promise.all([
        editorialRiders
          .find(filter)
          .project(PUBLIC_RIDER_PROJECTION)
          .sort({ canonicalName: 1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        editorialRiders.countDocuments(filter),
      ]);

      res.send({ items, page, limit, total, pages: Math.ceil(total / limit) });
    } catch (error) {
      console.error('Error fetching editorial riders:', error);
      res.status(500).send({ error: 'Unable to load editorial riders' });
    }
  });

  router.get('/editorial/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    if (slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).send({ error: 'Invalid rider slug' });
    }

    try {
      const rider = await editorialRiders.findOne(
        { slug, reviewStatus: 'published' },
        { projection: PUBLIC_RIDER_PROJECTION },
      );
      if (!rider) return res.status(404).send({ error: 'Rider not found' });
      res.send(rider);
    } catch (error) {
      console.error('Error fetching editorial rider:', error);
      res.status(500).send({ error: 'Unable to load editorial rider' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
      const query = String(req.query.q || '')
        .trim()
        .slice(0, 80);
      const sport = String(req.query.sport || '')
        .trim()
        .slice(0, 40);
      const filter = { network: true, isBot: { $ne: true } };

      if (query) {
        const safeQuery = { $regex: escapeRegex(query), $options: 'i' };
        filter.$or = [
          { name: safeQuery },
          { bio: safeQuery },
          { 'riderProfile.nickname': safeQuery },
          { 'riderProfile.nationality': safeQuery },
        ];
      }
      if (sport) filter.sports = { $regex: `^${escapeRegex(sport)}$`, $options: 'i' };

      const [items, total] = await Promise.all([
        users
          .find(filter)
          .project(RIDER_PROJECTION)
          .sort({ createdAt: -1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        users.countDocuments(filter),
      ]);

      res.send({ items, page, limit, total, pages: Math.ceil(total / limit) });
    } catch (error) {
      console.error('Error fetching riders:', error);
      res.status(500).send({ error: 'Unable to load riders' });
    }
  });

  router.get('/:id', async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).send({ error: 'Invalid rider ID' });
    }
    try {
      const rider = await users.findOne(
        { _id: new ObjectId(req.params.id), network: true, isBot: { $ne: true } },
        { projection: RIDER_PROJECTION },
      );
      if (!rider) return res.status(404).send({ error: 'Rider not found' });
      res.send(rider);
    } catch (error) {
      console.error('Error fetching rider:', error);
      res.status(500).send({ error: 'Unable to load rider' });
    }
  });

  return router;
};
