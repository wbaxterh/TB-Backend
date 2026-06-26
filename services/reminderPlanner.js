/**
 * Reminder planner — given a (user, list, cadence), writes the next 30 days
 * worth of `scheduledNotifications` rows. Idempotent: deletes pending future
 * rows for the same (user, list) first, so changing cadence cleanly replans.
 *
 * Spec: docs/features/notifications.md §6.3
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const COLL = 'scheduledNotifications';
const CADENCE_COLL = 'reminderCadences';
const LISTS_COLL = 'tricklists';
const USERS_COLL = 'users';

const PLAN_HORIZON_DAYS = 30;
const DEFAULT_FIRE_HOUR_LOCAL = 10; // 10am local
const DEFAULT_FIRE_MINUTE_LOCAL = 0;
const WEEKLY_DAY = 0; // Sunday
const THREE_X_WEEK_DAYS = [1, 3, 5]; // Mon/Wed/Fri

let _db = null;

function init(db) {
  _db = db;
  db.collection(COLL)
    .createIndex({ scheduledFor: 1, status: 1 }, { background: true })
    .catch(() => {});
  db.collection(COLL)
    .createIndex({ idempotencyKey: 1 }, { unique: true, background: true })
    .catch(() => {});
  db.collection(COLL)
    .createIndex({ userId: 1, listId: 1 }, { background: true })
    .catch(() => {});

  db.collection(CADENCE_COLL)
    .createIndex({ userId: 1, listId: 1 }, { unique: true, background: true })
    .catch(() => {});
  db.collection(CADENCE_COLL)
    .createIndex({ cadence: 1 }, { background: true })
    .catch(() => {});
}

function db() {
  if (!_db) throw new Error('reminderPlanner not initialized — call init(db)');
  return _db;
}

function toObjectId(v) {
  if (v instanceof ObjectId) return v;
  try {
    return new ObjectId(String(v));
  } catch {
    return null;
  }
}

/**
 * Convert a wall-clock time (year/month/day/hour/min) in a given IANA timezone
 * to its corresponding UTC `Date`. Handles DST by iterative refinement using
 * Intl.DateTimeFormat. Off by an hour at most across DST boundaries; acceptable.
 */
function wallClockToUtc(year, month, day, hour, minute, tz) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(naiveUtc));
  const tzHour = Number(parts.find((p) => p.type === 'hour').value);
  const tzMinute = Number(parts.find((p) => p.type === 'minute').value);
  const want = hour * 60 + minute;
  const got = tzHour * 60 + tzMinute;
  return new Date(naiveUtc + (want - got) * 60000);
}

function idempotencyKey(userId, listId, scheduledForIso) {
  return crypto.createHash('sha1').update(`${userId}:${listId}:${scheduledForIso}`).digest('hex');
}

/**
 * Build the list of fire-times for a single cadence over the planning horizon.
 * All dates returned are UTC.
 */
function buildFireTimes(cadence, tz, fromDate = new Date()) {
  const hour = DEFAULT_FIRE_HOUR_LOCAL;
  const minute = DEFAULT_FIRE_MINUTE_LOCAL;
  const out = [];
  const horizon = new Date(fromDate.getTime() + PLAN_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  // Start from "tomorrow local" so we never schedule retroactively.
  const startLocal = new Date(fromDate);
  startLocal.setUTCHours(startLocal.getUTCHours() + 24);

  // Walk one day at a time across the horizon.
  for (
    let cursor = new Date(startLocal);
    cursor <= horizon;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    // Get the local Y/M/D for this UTC instant in the user's tz.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(cursor);
    const year = Number(parts.find((p) => p.type === 'year').value);
    const month = Number(parts.find((p) => p.type === 'month').value);
    const day = Number(parts.find((p) => p.type === 'day').value);
    const weekdayStr = parts.find((p) => p.type === 'weekday').value;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayStr);

    let include = false;
    if (cadence === 'daily') include = true;
    else if (cadence === '3x-week') include = THREE_X_WEEK_DAYS.includes(weekday);
    else if (cadence === 'weekly') include = weekday === WEEKLY_DAY;

    if (include) {
      out.push(wallClockToUtc(year, month, day, hour, minute, tz));
    }
  }

  // Dedupe (DST boundary can produce same UTC twice) and sort.
  const seen = new Set();
  return out
    .filter((d) => {
      const k = d.getTime();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a - b);
}

async function getUserTimezone(userId) {
  const user = await db()
    .collection(USERS_COLL)
    .findOne(
      { _id: toObjectId(userId) },
      { projection: { 'notificationPreferences.quietHours.timezone': 1 } },
    );
  return user?.notificationPreferences?.quietHours?.timezone || 'America/New_York';
}

/**
 * Plan the next 30 days for one (user, list). Returns the count of rows inserted.
 * If cadence === 'off', clears existing pending rows and returns 0.
 */
async function planNext30Days(userId, listId, cadence) {
  const uid = toObjectId(userId);
  const lid = toObjectId(listId);
  if (!uid || !lid) throw new Error('planNext30Days: invalid userId or listId');

  const tz = await getUserTimezone(uid);

  // Cancel any pending future rows for this (user, list). 'sent' rows are
  // preserved for audit; only 'pending' moves to 'cancelled'.
  await db()
    .collection(COLL)
    .updateMany(
      { userId: uid, listId: lid, status: 'pending', scheduledFor: { $gte: new Date() } },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    );

  if (cadence === 'off') return 0;

  const fireTimes = buildFireTimes(cadence, tz);
  if (fireTimes.length === 0) return 0;

  const now = new Date();
  const docs = fireTimes.map((scheduledFor) => ({
    userId: uid,
    listId: lid,
    category: 'reminder',
    scheduledFor,
    status: 'pending',
    idempotencyKey: idempotencyKey(uid.toString(), lid.toString(), scheduledFor.toISOString()),
    attemptCount: 0,
    lastAttemptAt: null,
    createdAt: now,
  }));

  try {
    const result = await db().collection(COLL).insertMany(docs, { ordered: false });
    return result.insertedCount;
  } catch (err) {
    // Duplicate idempotency keys are fine (rapid replans). Re-throw anything else.
    if (err?.code === 11000 || err?.writeErrors?.every((e) => e.code === 11000)) {
      return err?.result?.nInserted || 0;
    }
    throw err;
  }
}

/**
 * Set a user's cadence for a list and immediately replan. Pass `cadence: 'off'`
 * to disable. Returns the updated cadence doc + count of planned rows.
 */
async function setCadence(userId, listId, cadence) {
  const allowed = ['off', 'daily', '3x-week', 'weekly'];
  if (!allowed.includes(cadence)) throw new Error(`setCadence: bad cadence ${cadence}`);

  const uid = toObjectId(userId);
  const lid = toObjectId(listId);
  if (!uid || !lid) throw new Error('setCadence: invalid userId or listId');

  await db()
    .collection(CADENCE_COLL)
    .updateOne(
      { userId: uid, listId: lid },
      {
        $set: { cadence, updatedAt: new Date(), pausedReason: null },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

  const planned = await planNext30Days(uid, lid, cadence);
  return { cadence, planned };
}

async function getAllCadencesForUser(userId) {
  const uid = toObjectId(userId);
  if (!uid) return [];
  return db().collection(CADENCE_COLL).find({ userId: uid }).toArray();
}

async function getCadence(userId, listId) {
  const uid = toObjectId(userId);
  const lid = toObjectId(listId);
  if (!uid || !lid) return null;
  return db().collection(CADENCE_COLL).findOne({ userId: uid, listId: lid });
}

/**
 * Auto-pause cadence on lists the user hasn't opened in 60+ days.
 * Called from a daily cron. Marks `pausedReason: 'auto-60d'` and clears pending rows.
 * The mobile app re-engages by showing a "Resume reminders?" prompt next open.
 */
async function autoPauseStaleLists() {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const stale = await db()
    .collection(CADENCE_COLL)
    .aggregate([
      { $match: { cadence: { $ne: 'off' }, pausedReason: null } },
      {
        $lookup: {
          from: LISTS_COLL,
          let: { lid: '$listId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$lid'] } } },
            { $project: { lastViewedAt: 1, updatedAt: 1 } },
          ],
          as: 'list',
        },
      },
      { $unwind: { path: '$list', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          lastActive: { $ifNull: ['$list.lastViewedAt', '$list.updatedAt'] },
        },
      },
      { $match: { lastActive: { $lte: cutoff } } },
      { $project: { userId: 1, listId: 1 } },
    ])
    .toArray();

  let paused = 0;
  for (const row of stale) {
    await db()
      .collection(CADENCE_COLL)
      .updateOne({ _id: row._id }, { $set: { pausedReason: 'auto-60d', updatedAt: new Date() } });
    await db()
      .collection(COLL)
      .updateMany(
        {
          userId: row.userId,
          listId: row.listId,
          status: 'pending',
          scheduledFor: { $gte: new Date() },
        },
        { $set: { status: 'cancelled', cancelledAt: new Date() } },
      );
    paused++;
  }
  return paused;
}

module.exports = {
  init,
  planNext30Days,
  setCadence,
  getCadence,
  getAllCadencesForUser,
  autoPauseStaleLists,
  // exported for the sender + tests
  _internals: { COLL, CADENCE_COLL, LISTS_COLL, PLAN_HORIZON_DAYS, idempotencyKey },
};
