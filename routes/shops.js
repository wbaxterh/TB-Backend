const express = require('express');
const { ObjectId } = require('mongodb');
const escapeRegex = require('../utils/escapeRegex');

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const SPORTS = new Set([
  'skateboarding',
  'snowboarding',
  'skiing',
  'surfing',
  'bmx',
  'mtb',
  'scooter',
  'rollerblading',
  'wakeboarding',
]);
const SERVICES = new Set(['gear', 'apparel', 'repairs', 'rentals', 'lessons', 'online']);

const PUBLIC_SHOP_PROJECTION = {
  name: 1,
  slug: 1,
  description: 1,
  sports: 1,
  services: 1,
  address: 1,
  website: 1,
  phone: 1,
  imageUrl: 1,
  hours: 1,
  socialLinks: 1,
  verified: 1,
  featured: 1,
  updatedAt: 1,
};

function parseListQuery(query) {
  const cursor = Math.max(0, Number.parseInt(query.cursor, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const sport = query.sport && query.sport !== 'all' ? String(query.sport).toLowerCase() : null;
  const service =
    query.service && query.service !== 'all' ? String(query.service).toLowerCase() : null;

  if (sport && !SPORTS.has(sport)) return { error: 'Invalid sport' };
  if (service && !SERVICES.has(service)) return { error: 'Invalid service' };
  return { cursor, limit, sport, service };
}

module.exports = (db) => {
  const router = express.Router();
  const shops = db.collection('shops');

  shops.createIndex({ slug: 1 }, { unique: true, background: true }).catch(() => {});
  shops.createIndex({ status: 1, featured: -1, name: 1 }, { background: true }).catch(() => {});
  shops.createIndex({ sports: 1, services: 1 }, { background: true }).catch(() => {});
  shops.createIndex({ 'address.location': '2dsphere' }, { background: true }).catch(() => {});

  // GET /api/shops - public, filtered, cursor-paginated shop directory.
  router.get('/', async (req, res) => {
    try {
      const parsed = parseListQuery(req.query);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const and = [{ status: 'published' }];
      if (parsed.sport) and.push({ sports: parsed.sport });
      if (parsed.service) and.push({ services: parsed.service });
      if (req.query.q) {
        const rx = { $regex: escapeRegex(String(req.query.q).trim()), $options: 'i' };
        and.push({ $or: [{ name: rx }, { description: rx }, { 'address.city': rx }] });
      }
      if (req.query.location) {
        const rx = { $regex: escapeRegex(String(req.query.location).trim()), $options: 'i' };
        and.push({
          $or: [
            { 'address.city': rx },
            { 'address.region': rx },
            { 'address.postalCode': rx },
            { 'address.country': rx },
          ],
        });
      }

      const filter = { $and: and };
      const totalCount = await shops.countDocuments(filter);
      const docs = await shops
        .find(filter)
        .project(PUBLIC_SHOP_PROJECTION)
        .sort({ featured: -1, name: 1, _id: 1 })
        .skip(parsed.cursor)
        .limit(parsed.limit)
        .toArray();
      const nextCursor =
        parsed.cursor + docs.length < totalCount ? String(parsed.cursor + docs.length) : null;

      res.json({ shops: docs, nextCursor, totalCount });
    } catch (error) {
      console.error('Error listing shops', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /api/shops/:slugOrId - public shop detail.
  router.get('/:slugOrId', async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const or = [{ slug: slugOrId }];
      if (ObjectId.isValid(slugOrId)) or.push({ _id: new ObjectId(slugOrId) });
      const shop = await shops.findOne(
        { status: 'published', $or: or },
        { projection: PUBLIC_SHOP_PROJECTION },
      );
      if (!shop) return res.status(404).json({ error: 'Shop not found' });
      res.json({ shop });
    } catch (error) {
      console.error('Error fetching shop', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
};

module.exports.PUBLIC_SHOP_PROJECTION = PUBLIC_SHOP_PROJECTION;
module.exports.SERVICES = SERVICES;
module.exports.SPORTS = SPORTS;
