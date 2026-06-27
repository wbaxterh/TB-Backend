/**
 * Notification preferences CRUD.
 *
 * GET   /api/users/me/notification-preferences   returns full prefs subdoc
 * PATCH /api/users/me/notification-preferences   partial deep-merge update
 *
 * Spec: docs/docs/features/notifications.md §5
 */

const express = require('express');
const Joi = require('joi');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const validateWith = require('../middleware/validation');
const { buildDefaultNotificationPreferences } = require('../services/notificationDefaults');

const categorySchema = Joi.object({
  push: Joi.boolean().optional(),
  inApp: Joi.boolean().optional(),
  email: Joi.boolean().optional(),
});

const timeStr = Joi.string().regex(/^\d{2}:\d{2}$/);

const patchSchema = {
  messages: categorySchema.optional(),
  reminders: categorySchema.optional(),
  homies: categorySchema.optional(),
  quietHours: Joi.object({
    start: timeStr.optional(),
    end: timeStr.optional(),
    timezone: Joi.string().optional(),
  }).optional(),
  osPermission: Joi.object({
    ios: Joi.string().valid('granted', 'denied', 'unknown', 'provisional').optional(),
    android: Joi.string().valid('granted', 'denied', 'unknown', 'provisional').optional(),
    web: Joi.string().valid('granted', 'denied', 'unknown', 'provisional').optional(),
  }).optional(),
};

module.exports = (db) => {
  const router = express.Router();
  const users = db.collection('users');

  router.get('/', [auth], async (req, res) => {
    let _id;
    try {
      _id = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    try {
      const user = await users.findOne({ _id }, { projection: { notificationPreferences: 1 } });
      if (!user) return res.status(404).json({ error: 'User not found' });
      // Backfill on read if a legacy user has no prefs subdoc — keeps the API contract clean
      // even before the migration script is run.
      const prefs = user.notificationPreferences || buildDefaultNotificationPreferences();
      res.json({ notificationPreferences: prefs });
    } catch (err) {
      console.error('[notificationPreferences] get failed', err);
      res.status(500).json({ error: 'Failed to load preferences' });
    }
  });

  router.patch('/', [auth, validateWith(patchSchema)], async (req, res) => {
    let _id;
    try {
      _id = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // Build a dotted-path $set so we don't clobber adjacent keys (e.g. PATCH messages.push
    // shouldn't wipe messages.inApp). Whitelist keys to prevent injection.
    const set = {};
    const allow = {
      messages: ['push', 'inApp', 'email'],
      reminders: ['push', 'inApp', 'email'],
      homies: ['push', 'inApp', 'email'],
      quietHours: ['start', 'end', 'timezone'],
      osPermission: ['ios', 'android', 'web'],
    };
    for (const [section, fields] of Object.entries(allow)) {
      const incoming = req.body[section];
      if (!incoming || typeof incoming !== 'object') continue;
      for (const f of fields) {
        if (incoming[f] !== undefined) {
          set[`notificationPreferences.${section}.${f}`] = incoming[f];
        }
      }
    }
    set['notificationPreferences.updatedAt'] = new Date();

    try {
      // Ensure the subdoc exists with defaults before applying the dotted patch.
      const exists = await users.findOne(
        { _id },
        { projection: { 'notificationPreferences.updatedAt': 1 } },
      );
      if (!exists) return res.status(404).json({ error: 'User not found' });
      if (!exists.notificationPreferences) {
        await users.updateOne(
          { _id, notificationPreferences: { $exists: false } },
          { $set: { notificationPreferences: buildDefaultNotificationPreferences() } },
        );
      }

      await users.updateOne({ _id }, { $set: set });

      const updated = await users.findOne({ _id }, { projection: { notificationPreferences: 1 } });
      res.json({ notificationPreferences: updated.notificationPreferences });
    } catch (err) {
      console.error('[notificationPreferences] patch failed', err);
      res.status(500).json({ error: 'Failed to update preferences' });
    }
  });

  return router;
};
