const express = require('express');
const { ObjectId } = require('mongodb');
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
