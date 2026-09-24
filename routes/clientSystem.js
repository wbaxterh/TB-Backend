const express = require('express');
const Joi = require('joi');
const { ObjectId } = require('mongodb');
const { verifyTokenWithGrace } = require('../middleware/auth');
const { classifyVersion, compareVersions } = require('../services/analyticsContracts');

const heartbeatSchema = Joi.object({
  installationId: Joi.string().min(8).max(128).required(),
  platform: Joi.string().valid('ios', 'android', 'web').required(),
  appVersion: Joi.string().max(32).required(),
  buildNumber: Joi.alternatives().try(Joi.string().max(32), Joi.number().integer()).required(),
  osVersion: Joi.string().max(64).allow(null, ''),
  deviceModel: Joi.string().max(128).allow(null, ''),
  locale: Joi.string().max(32).allow(null, ''),
  timezone: Joi.string().max(64).allow(null, ''),
  notificationsEnabled: Joi.boolean(),
});

const policySchema = Joi.object({
  platform: Joi.string().valid('ios', 'android', 'web').required(),
  latestVersion: Joi.string().max(32).required(),
  minimumSupportedVersion: Joi.string().max(32).required(),
  title: Joi.string().max(100).required(),
  message: Joi.string().max(500).required(),
  storeUrl: Joi.string().uri().required(),
  effectiveAt: Joi.date().iso().required(),
  gracePeriodHours: Joi.number().integer().min(0).max(720).default(24),
  reason: Joi.string().max(500).required(),
});

module.exports = (db) => {
  const router = express.Router();
  const installations = db.collection('client_installations');
  const history = db.collection('client_version_history');
  const policies = db.collection('mobile_version_policies');
  const users = db.collection('users');

  installations.createIndex({ installationId: 1 }, { unique: true });
  installations.createIndex({ platform: 1, lastSeenAt: -1 });
  history.createIndex({ installationId: 1, changedAt: -1 });
  policies.createIndex({ platform: 1, revision: -1 }, { unique: true });

  const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

  function optionalUser(req) {
    return verifyTokenWithGrace(req.header('x-auth-token'))?.userId || null;
  }

  async function requireAdmin(req, res, next) {
    try {
      const payload = verifyTokenWithGrace(req.header('x-auth-token'));
      if (!payload?.userId) return res.status(401).json({ error: 'Authentication required' });
      const user = await users.findOne(
        { _id: new ObjectId(payload.userId) },
        { projection: { role: 1 } },
      );
      if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      req.user = payload;
      next();
    } catch (_error) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }
  }

  async function currentPolicy(platform) {
    const configured = await policies.findOne({ platform }, { sort: { revision: -1 } });
    if (configured) return configured;
    const latestVersion =
      process.env[`LATEST_${platform.toUpperCase()}_VERSION`] ||
      (platform === 'web' ? 'web' : '3.3.0');
    const storeUrl =
      platform === 'ios'
        ? 'https://apps.apple.com/us/app/the-trick-book/id6446022788'
        : platform === 'android'
          ? 'https://play.google.com/store/apps/details?id=com.thetrickbook.trickbook'
          : 'https://thetrickbook.com';
    return {
      platform,
      latestVersion,
      minimumSupportedVersion: '0.0.0',
      title: 'A new TrickBook is ready',
      message: 'Update for the latest progression tools, fixes, and community features.',
      storeUrl,
      effectiveAt: new Date(0),
      gracePeriodHours: 0,
      revision: 0,
    };
  }

  function publicPolicy(policy, appVersion) {
    if (!policy) return { status: 'current', policyRevision: 0 };
    const effectiveAt = new Date(policy.effectiveAt);
    const graceEndsAt = new Date(effectiveAt.getTime() + policy.gracePeriodHours * 60 * 60 * 1000);
    let status = classifyVersion(appVersion, policy);
    if (status === 'required' && Date.now() < graceEndsAt.getTime()) status = 'optional';
    return {
      status,
      latestVersion: policy.latestVersion,
      minimumSupportedVersion: policy.minimumSupportedVersion,
      title: policy.title,
      message: policy.message,
      storeUrl: policy.storeUrl,
      effectiveAt,
      graceEndsAt,
      policyRevision: policy.revision,
    };
  }

  router.get(
    '/version-policy',
    asyncHandler(async (req, res) => {
      const platform = req.query.platform;
      const appVersion = String(req.query.appVersion || '0');
      if (!['ios', 'android', 'web'].includes(platform)) {
        return res.status(400).json({ error: 'valid platform is required' });
      }
      res.json(publicPolicy(await currentPolicy(platform), appVersion));
    }),
  );

  router.post(
    '/heartbeat',
    asyncHandler(async (req, res) => {
      const { error, value } = heartbeatSchema.validate(req.body, { stripUnknown: true });
      if (error) return res.status(400).json({ error: error.details[0].message });
      const now = new Date();
      const previous = await installations.findOne({ installationId: value.installationId });
      const userId = optionalUser(req);
      const doc = {
        ...value,
        buildNumber: String(value.buildNumber),
        userId,
        lastSeenAt: now,
        updatedAt: now,
      };
      await installations.updateOne(
        { installationId: value.installationId },
        { $set: doc, $setOnInsert: { firstSeenAt: now } },
        { upsert: true },
      );
      if (
        !previous ||
        previous.appVersion !== value.appVersion ||
        String(previous.buildNumber) !== String(value.buildNumber)
      ) {
        await history.insertOne({
          installationId: value.installationId,
          userId,
          platform: value.platform,
          appVersion: value.appVersion,
          buildNumber: String(value.buildNumber),
          previousVersion: previous?.appVersion || null,
          changedAt: now,
        });
      }
      res.json({
        ok: true,
        updatePolicy: publicPolicy(await currentPolicy(value.platform), value.appVersion),
      });
    }),
  );

  router.get(
    '/admin/versions',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const days = Math.min(Number.parseInt(req.query.days, 10) || 30, 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const versions = await installations
        .aggregate([
          { $match: { lastSeenAt: { $gte: since } } },
          {
            $group: {
              _id: {
                platform: '$platform',
                appVersion: '$appVersion',
                buildNumber: '$buildNumber',
              },
              installations: { $sum: 1 },
              users: { $addToSet: '$userId' },
              lastSeenAt: { $max: '$lastSeenAt' },
            },
          },
          {
            $project: {
              _id: 0,
              platform: '$_id.platform',
              appVersion: '$_id.appVersion',
              buildNumber: '$_id.buildNumber',
              installations: 1,
              users: { $size: { $setDifference: ['$users', [null]] } },
              lastSeenAt: 1,
            },
          },
          { $sort: { platform: 1, appVersion: -1, buildNumber: -1 } },
        ])
        .toArray();
      res.json({ days, versions });
    }),
  );

  router.put(
    '/admin/version-policy',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { error, value } = policySchema.validate(req.body, { stripUnknown: true });
      if (error) return res.status(400).json({ error: error.details[0].message });
      if (compareVersions(value.minimumSupportedVersion, value.latestVersion) > 0) {
        return res
          .status(400)
          .json({ error: 'minimumSupportedVersion cannot exceed latestVersion' });
      }
      const latest = await currentPolicy(value.platform);
      const policy = {
        ...value,
        effectiveAt: new Date(value.effectiveAt),
        revision: (latest?.revision || 0) + 1,
        createdAt: new Date(),
        createdBy: req.user.userId,
      };
      await policies.insertOne(policy);
      res.status(201).json(publicPolicy(policy, value.latestVersion));
    }),
  );

  return router;
};
