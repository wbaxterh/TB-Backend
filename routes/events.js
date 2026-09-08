const express = require('express');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const escapeRegex = require('../utils/escapeRegex');

const PAGE_SIZE = 20;

// Coming date windows (UTC) for the frontend's date filter.
function dateRangeFor(dateId) {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const plusDays = (d) => {
    const x = new Date(startOfToday);
    x.setUTCDate(x.getUTCDate() + d);
    return x;
  };
  if (dateId === 'week') return { $gte: startOfToday, $lte: plusDays(7) };
  if (dateId === 'month') return { $gte: startOfToday, $lte: plusDays(30) };
  if (dateId === 'weekend') {
    const day = startOfToday.getUTCDay(); // 0 Sun .. 6 Sat
    const sat = plusDays((6 - day + 7) % 7);
    const mon = new Date(sat);
    mon.setUTCDate(mon.getUTCDate() + 2);
    return { $gte: sat, $lt: mon };
  }
  return null;
}

module.exports = (db) => {
  const router = express.Router();
  const events = db.collection('events');
  const saves = db.collection('event_saves');

  events.createIndex({ startAt: 1 }, { background: true }).catch(() => {});
  saves.createIndex({ userId: 1, eventId: 1 }, { unique: true, background: true }).catch(() => {});

  // GET /api/events — filtered, cursor-paginated list
  router.get('/', async (req, res) => {
    try {
      const { q, sport, discipline, location, date, intent, registration, view } = req.query;
      const cursor = Math.max(0, parseInt(req.query.cursor, 10) || 0);

      const now = new Date();

      const and = [];
      if (view === 'archive') {
        and.push({
          $or: [
            { endAt: { $lt: now } },
            { endAt: { $in: [null, ''] }, startAt: { $lt: now } },
            { endAt: { $exists: false }, startAt: { $lt: now } },
          ],
        });
      } else {
        and.push({
          $or: [
            { endAt: { $gte: now } },
            { endAt: { $in: [null, ''] }, startAt: { $gte: now } },
            { endAt: { $exists: false }, startAt: { $gte: now } },
          ],
        });
      }
      if (q) {
        const rx = { $regex: escapeRegex(q), $options: 'i' };
        and.push({ $or: [{ title: rx }, { 'organizer.name': rx }, { series: rx }] });
      }
      if (sport && sport !== 'all') and.push({ sports: sport });
      if (discipline && discipline !== 'all') and.push({ disciplines: discipline });
      if (location) {
        const rx = { $regex: escapeRegex(location), $options: 'i' };
        and.push({
          $or: [{ 'venue.city': rx }, { 'venue.region': rx }, { 'venue.country': rx }],
        });
      }
      const dateRange = dateRangeFor(date);
      if (dateRange) and.push({ startAt: dateRange });

      if (registration === 'open') and.push({ 'participation.registrationStatus': 'open' });

      if (intent && intent !== 'all') {
        if (intent === 'compete') and.push({ 'participation.registrationStatus': 'open' });
        else if (intent === 'spectate_in_person') and.push({ 'spectating.inPerson': true });
        else if (intent === 'spectate_online')
          and.push({ 'spectating.streamUrl': { $nin: [null, ''] } });
        else if (intent === 'community')
          and.push({ series: { $regex: 'community', $options: 'i' } });
      }

      const query = and.length ? { $and: and } : {};

      const totalCount = await events.countDocuments(query);
      const sort = view === 'archive' ? { startAt: -1, _id: 1 } : { startAt: 1, _id: 1 };
      const docs = await events
        .aggregate([{ $match: query }, { $sort: sort }, { $skip: cursor }, { $limit: PAGE_SIZE }])
        .toArray();

      const nextCursor = cursor + docs.length < totalCount ? String(cursor + docs.length) : null;
      res.json({ events: docs, nextCursor, totalCount });
    } catch (err) {
      console.error('Error listing events', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /api/events/:slugOrId — single event
  router.get('/:slugOrId', async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const or = [{ slug: slugOrId }];
      if (ObjectId.isValid(slugOrId)) or.push({ _id: new ObjectId(slugOrId) });
      const event = await events.findOne({ $or: or });
      if (!event) return res.status(404).json({ error: 'Event not found' });
      res.json({ event });
    } catch (err) {
      console.error('Error fetching event', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /api/events/:id/save — save an event for the current user
  router.post('/:id/save', auth, async (req, res) => {
    try {
      await saves.updateOne(
        { userId: req.user.userId, eventId: req.params.id },
        { $set: { userId: req.user.userId, eventId: req.params.id, createdAt: new Date() } },
        { upsert: true },
      );
      res.json({ success: true, saved: true });
    } catch (err) {
      console.error('Error saving event', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // DELETE /api/events/:id/save — unsave
  router.delete('/:id/save', auth, async (req, res) => {
    try {
      await saves.deleteOne({ userId: req.user.userId, eventId: req.params.id });
      res.json({ success: true, saved: false });
    } catch (err) {
      console.error('Error unsaving event', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
};
