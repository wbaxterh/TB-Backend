/**
 * Push token registry.
 *
 * POST   /api/push-tokens            register or upsert a token for the current user
 * DELETE /api/push-tokens/:token     unregister (on logout / device removal)
 * GET    /api/push-tokens/me         list current user's live tokens (debug)
 *
 * Replaces the legacy /api/expoPushTokens stub that wrote to an in-memory store.
 * Spec: docs/docs/features/notifications.md §5
 */

const express = require('express');
const Joi = require('joi');
const { Expo } = require('expo-server-sdk');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const validateWith = require('../middleware/validation');

const PLATFORMS = ['ios', 'android', 'web'];
const TRANSPORTS = ['expo', 'fcm', 'apns', 'webpush'];

const upsertSchema = {
  token: Joi.string().required(),
  platform: Joi.string()
    .valid(...PLATFORMS)
    .required(),
  transport: Joi.string()
    .valid(...TRANSPORTS)
    .default('expo'),
  appVersion: Joi.string().allow('').optional(),
  deviceModel: Joi.string().allow('').optional(),
  locale: Joi.string().allow('').optional(),
  timezone: Joi.string().allow('').optional(),
  // Web push only
  endpoint: Joi.string().uri().optional(),
  keys: Joi.object({
    p256dh: Joi.string().required(),
    auth: Joi.string().required(),
  }).optional(),
};

module.exports = (db) => {
  const router = express.Router();
  const collection = db.collection('pushTokens');

  router.post('/', [auth, validateWith(upsertSchema)], async (req, res) => {
    const {
      token,
      platform,
      transport,
      appVersion,
      deviceModel,
      locale,
      timezone,
      endpoint,
      keys,
    } = req.body;

    // Validate Expo tokens early so we don't store garbage.
    if ((transport === 'expo' || !transport) && !Expo.isExpoPushToken(token)) {
      return res.status(400).json({ error: 'Invalid Expo push token format' });
    }

    let userId;
    try {
      userId = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const now = new Date();
    const setFields = {
      userId,
      platform,
      transport: transport || 'expo',
      appVersion: appVersion || null,
      deviceModel: deviceModel || null,
      locale: locale || null,
      timezone: timezone || null,
      lastSeenAt: now,
      deadAt: null,
      deadReason: null,
    };
    if (endpoint) setFields.endpoint = endpoint;
    if (keys) setFields.keys = keys;

    try {
      const result = await collection.findOneAndUpdate(
        { token },
        {
          $set: setFields,
          $setOnInsert: { token, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      res.status(201).json({
        ok: true,
        tokenId: result?.value?._id || null,
      });
    } catch (err) {
      console.error('[pushTokens] upsert failed', err);
      res.status(500).json({ error: 'Failed to register push token' });
    }
  });

  router.delete('/:token', [auth], async (req, res) => {
    const { token } = req.params;
    let userId;
    try {
      userId = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    try {
      // Only allow a user to delete their own tokens.
      const result = await collection.deleteOne({ token, userId });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Token not found' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[pushTokens] delete failed', err);
      res.status(500).json({ error: 'Failed to delete push token' });
    }
  });

  router.get('/me', [auth], async (req, res) => {
    let userId;
    try {
      userId = new ObjectId(req.user.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    try {
      const tokens = await collection
        .find({ userId }, { projection: { token: 0, keys: 0 } })
        .toArray();
      res.json({ tokens });
    } catch (err) {
      console.error('[pushTokens] list failed', err);
      res.status(500).json({ error: 'Failed to list push tokens' });
    }
  });

  return router;
};
