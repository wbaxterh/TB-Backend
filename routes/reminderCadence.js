/**
 * Reminder cadence CRUD.
 *
 * GET  /api/users/me/reminder-cadence            list all per-list cadences for the user
 * GET  /api/users/me/reminder-cadence/:listId    one list
 * PUT  /api/users/me/reminder-cadence/:listId    set cadence; replans next 30 days
 * GET  /api/users/me/scheduled-notifications     upcoming pending reminders (for local pre-scheduling on mobile)
 *
 * Spec: docs/features/notifications.md §5, §6.3
 */

const express = require('express');
const Joi = require('joi');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const validateWith = require('../middleware/validation');
const reminderPlanner = require('../services/reminderPlanner');

const setCadenceSchema = {
  cadence: Joi.string().valid('off', 'daily', '3x-week', 'weekly').required(),
};

module.exports = (db) => {
  const router = express.Router();

  router.get('/', [auth], async (req, res) => {
    let uid;
    try {
      uid = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    try {
      const rows = await reminderPlanner.getAllCadencesForUser(uid);
      res.json({ cadences: rows });
    } catch (err) {
      console.error('[reminderCadence] list failed', err);
      res.status(500).json({ error: 'Failed to list cadences' });
    }
  });

  router.get('/scheduled-notifications', [auth], async (req, res) => {
    let uid;
    try {
      uid = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const withinDays = Math.min(Math.max(parseInt(req.query.within, 10) || 14, 1), 30);
    const horizon = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    try {
      const rows = await db
        .collection('scheduledNotifications')
        .find({
          userId: uid,
          status: 'pending',
          category: 'reminder',
          scheduledFor: { $gte: new Date(), $lte: horizon },
        })
        .sort({ scheduledFor: 1 })
        .limit(200)
        .toArray();
      res.json({ scheduledNotifications: rows });
    } catch (err) {
      console.error('[reminderCadence] scheduled list failed', err);
      res.status(500).json({ error: 'Failed to load scheduled notifications' });
    }
  });

  router.get('/:listId', [auth], async (req, res) => {
    let uid, lid;
    try {
      uid = new ObjectId(req.user.userId);
      lid = new ObjectId(req.params.listId);
    } catch {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const row = await reminderPlanner.getCadence(uid, lid);
      res.json({ cadence: row?.cadence || 'off', pausedReason: row?.pausedReason || null });
    } catch (err) {
      console.error('[reminderCadence] get failed', err);
      res.status(500).json({ error: 'Failed to load cadence' });
    }
  });

  router.put('/:listId', [auth, validateWith(setCadenceSchema)], async (req, res) => {
    let uid, lid;
    try {
      uid = new ObjectId(req.user.userId);
      lid = new ObjectId(req.params.listId);
    } catch {
      return res.status(400).json({ error: 'Invalid id' });
    }
    try {
      const list = await db
        .collection('tricklists')
        .findOne({ _id: lid }, { projection: { _id: 1, 'user.$id': 1 } });
      if (!list) return res.status(404).json({ error: 'List not found' });

      // Sanity check ownership where possible. tricklists use DBRef "user.$id"
      // as a string of the userId — match what's there.
      const ownerId = list.user?.$id;
      if (ownerId && String(ownerId) !== String(req.user.userId)) {
        return res.status(403).json({ error: 'Not your list' });
      }

      const { cadence, planned } = await reminderPlanner.setCadence(uid, lid, req.body.cadence);
      res.json({ cadence, planned });
    } catch (err) {
      console.error('[reminderCadence] set failed', err);
      res.status(500).json({ error: 'Failed to set cadence' });
    }
  });

  return router;
};
