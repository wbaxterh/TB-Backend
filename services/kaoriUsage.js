const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { hasPremiumAccess } = require('../middleware/subscription');

const LIMITS = {
  free: {
    textDaily: 20,
    voiceLimit: 5,
    voicePeriod: 'day',
    accountPerMinute: 6,
    devicePerMinute: 10,
  },
  premium: {
    textDaily: 250,
    voiceLimit: 200,
    voicePeriod: 'month',
    accountPerMinute: 12,
    devicePerMinute: 20,
  },
};

const LEASE_MS = 45 * 1000;

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function minuteKey(date = new Date()) {
  return date.toISOString().slice(0, 16);
}

function nextUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function nextUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function privacyKey(value) {
  return crypto
    .createHash('sha256')
    .update(
      `${process.env.KAORI_USAGE_HASH_SALT || process.env.JWT_SECRET || 'trickbook'}:${value}`,
    )
    .digest('hex')
    .slice(0, 24);
}

function getDeviceKey(req) {
  const supplied = String(req.header('x-trickbook-device-id') || '').trim();
  const safeDevice = /^[a-zA-Z0-9_-]{16,128}$/.test(supplied) ? supplied : '';
  return privacyKey(safeDevice || req.ip || 'unknown');
}

function tierFor(user) {
  return hasPremiumAccess(user) ? 'premium' : 'free';
}

function createKaoriUsageService(db) {
  const counters = db.collection('kaori_usage_counters');
  const leases = db.collection('kaori_generation_leases');
  const events = db.collection('kaori_usage_events');
  const users = db.collection('users');

  counters.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  leases.createIndex({ userId: 1 }, { unique: true }).catch(() => {});
  leases.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  events.createIndex({ userId: 1, createdAt: -1 }).catch(() => {});
  events.createIndex({ requestId: 1 }, { unique: true }).catch(() => {});

  async function consumeCounter({ id, limit, expiresAt }) {
    try {
      await counters.updateOne(
        { _id: id },
        { $setOnInsert: { count: 0, createdAt: new Date(), expiresAt } },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }

    return counters.findOneAndUpdate(
      { _id: id, count: { $lt: limit } },
      { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
  }

  async function releaseLease(userId, requestId) {
    await leases.deleteOne({ userId, requestId });
  }

  // Reservation is intentionally one transaction-like orchestration path so every denial releases its lease.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the sequential guard flow is the safety boundary.
  async function reserveText({ userId, deviceKey, surface = 'unknown' }) {
    const now = new Date();
    const requestId = crypto.randomUUID();
    const user = ObjectId.isValid(userId)
      ? await users.findOne(
          { _id: new ObjectId(userId) },
          { projection: { role: 1, subscription: 1 } },
        )
      : null;
    if (!user) return { ok: false, status: 404, code: 'USER_NOT_FOUND' };

    const tier = tierFor(user);
    const limits = LIMITS[tier];
    const expiresAt = new Date(now.getTime() + LEASE_MS);

    try {
      await leases.findOneAndUpdate(
        { userId, $or: [{ expiresAt: { $lte: now } }, { requestId }] },
        { $set: { userId, requestId, deviceKey, surface, createdAt: now, expiresAt } },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (error?.code === 11000) {
        return { ok: false, status: 409, code: 'GENERATION_IN_PROGRESS', retryAfter: 5 };
      }
      throw error;
    }

    const globalDaily = await consumeCounter({
      id: `text:daily:global:${utcDayKey(now)}`,
      limit: Number(process.env.KAORI_DAILY_TEXT_BUDGET || 5000),
      expiresAt: nextUtcDay(now),
    });
    if (!(globalDaily?.value || globalDaily)?._id) {
      await releaseLease(userId, requestId);
      return { ok: false, status: 503, code: 'AI_BUDGET_REACHED', retryAfter: 3600 };
    }

    const minuteExpires = new Date(now.getTime() + 2 * 60 * 1000);
    const accountMinute = await consumeCounter({
      id: `text:minute:account:${userId}:${minuteKey(now)}`,
      limit: limits.accountPerMinute,
      expiresAt: minuteExpires,
    });
    if (!accountMinute?.value && !accountMinute?._id) {
      await releaseLease(userId, requestId);
      return { ok: false, status: 429, code: 'RATE_LIMITED', retryAfter: 60 };
    }

    const deviceMinute = await consumeCounter({
      id: `text:minute:device:${deviceKey}:${minuteKey(now)}`,
      limit: limits.devicePerMinute,
      expiresAt: minuteExpires,
    });
    if (!deviceMinute?.value && !deviceMinute?._id) {
      await releaseLease(userId, requestId);
      return { ok: false, status: 429, code: 'DEVICE_RATE_LIMITED', retryAfter: 60 };
    }

    const dailyId = `text:daily:${userId}:${utcDayKey(now)}`;
    const daily = await consumeCounter({
      id: dailyId,
      limit: limits.textDaily,
      expiresAt: nextUtcDay(now),
    });
    const dailyDocument = daily?.value || daily;
    if (!dailyDocument?._id) {
      await releaseLease(userId, requestId);
      return {
        ok: false,
        status: 402,
        code: 'ALLOWANCE_EXHAUSTED',
        tier,
        limit: limits.textDaily,
        remaining: 0,
        resetsAt: nextUtcDay(now),
        upgradeRequired: tier === 'free',
      };
    }

    await events.insertOne({
      requestId,
      userId,
      deviceKey,
      surface,
      kind: 'text_generation',
      tier,
      status: 'reserved',
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      requestId,
      userId,
      dailyId,
      tier,
      limit: limits.textDaily,
      remaining: Math.max(0, limits.textDaily - dailyDocument.count),
      resetsAt: nextUtcDay(now),
    };
  }

  async function settle(reservation, details = {}) {
    if (!reservation?.requestId) return;
    await events.updateOne(
      { requestId: reservation.requestId },
      { $set: { status: 'settled', settledAt: new Date(), updatedAt: new Date(), ...details } },
    );
    await releaseLease(reservation.userId, reservation.requestId);
  }

  async function refund(reservation, reason = 'generation_failed') {
    if (!reservation?.requestId) return;
    const result = await events.findOneAndUpdate(
      { requestId: reservation.requestId, status: 'reserved' },
      { $set: { status: 'refunded', reason, refundedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    const changed = result?.value || result;
    if (changed?._id) {
      await counters.updateOne(
        { _id: reservation.dailyId, count: { $gt: 0 } },
        { $inc: { count: -1 } },
      );
    }
    await releaseLease(reservation.userId, reservation.requestId);
  }

  async function getStatus(userId) {
    const now = new Date();
    const user = ObjectId.isValid(userId)
      ? await users.findOne(
          { _id: new ObjectId(userId) },
          { projection: { role: 1, subscription: 1 } },
        )
      : null;
    if (!user) return null;
    const tier = tierFor(user);
    const limit = LIMITS[tier].textDaily;
    const daily = await counters.findOne({ _id: `text:daily:${userId}:${utcDayKey(now)}` });
    const used = Math.min(limit, daily?.count || 0);
    const voicePeriod = LIMITS[tier].voicePeriod;
    const voiceKey = voicePeriod === 'month' ? monthKey(now) : utcDayKey(now);
    const voice = await counters.findOne({ _id: `voice:${voicePeriod}:${userId}:${voiceKey}` });
    const voiceLimit = LIMITS[tier].voiceLimit;
    const voiceUsed = Math.min(voiceLimit, voice?.count || 0);
    return {
      tier,
      text: { used, limit, remaining: Math.max(0, limit - used), resetsAt: nextUtcDay(now) },
      voice: {
        used: voiceUsed,
        limit: voiceLimit,
        remaining: Math.max(0, voiceLimit - voiceUsed),
        resetsAt: voicePeriod === 'month' ? nextUtcMonth(now) : nextUtcDay(now),
      },
      upgradeRequired: tier === 'free' && used >= limit,
    };
  }

  async function consumeVoice({ userId, requestId, responseChars = 0, surface = 'unknown' }) {
    const now = new Date();
    const user = ObjectId.isValid(userId)
      ? await users.findOne(
          { _id: new ObjectId(userId) },
          { projection: { role: 1, subscription: 1 } },
        )
      : null;
    if (!user) return { ok: false, code: 'USER_NOT_FOUND' };
    const tier = tierFor(user);
    const limits = LIMITS[tier];
    const key = limits.voicePeriod === 'month' ? monthKey(now) : utcDayKey(now);
    const expiresAt = limits.voicePeriod === 'month' ? nextUtcMonth(now) : nextUtcDay(now);
    const globalVoice = await consumeCounter({
      id: `voice:daily:global:${utcDayKey(now)}`,
      limit: Number(process.env.KAORI_DAILY_VOICE_BUDGET || 1000),
      expiresAt: nextUtcDay(now),
    });
    if (!(globalVoice?.value || globalVoice)?._id) {
      return { ok: false, code: 'VOICE_BUDGET_REACHED', remaining: 0, resetsAt: nextUtcDay(now) };
    }
    const counter = await consumeCounter({
      id: `voice:${limits.voicePeriod}:${userId}:${key}`,
      limit: limits.voiceLimit,
      expiresAt,
    });
    const document = counter?.value || counter;
    if (!document?._id) {
      return { ok: false, code: 'VOICE_ALLOWANCE_EXHAUSTED', remaining: 0, resetsAt: expiresAt };
    }
    await events.insertOne({
      requestId: `voice:${requestId || crypto.randomUUID()}`,
      userId,
      surface,
      kind: 'voice_reply',
      tier,
      status: 'settled',
      responseChars,
      createdAt: now,
      updatedAt: now,
    });
    return {
      ok: true,
      remaining: Math.max(0, limits.voiceLimit - document.count),
      resetsAt: expiresAt,
    };
  }

  return { consumeVoice, getDeviceKey, getStatus, refund, reserveText, settle };
}

module.exports = {
  LIMITS,
  createKaoriUsageService,
  getDeviceKey,
  minuteKey,
  monthKey,
  nextUtcMonth,
  nextUtcDay,
  utcDayKey,
};
