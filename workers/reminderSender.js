/**
 * Reminder sender worker.
 *
 * Every 5 minutes:
 *  1) Find `pending` scheduledNotifications rows where scheduledFor <= now.
 *  2) For each, pick the longest-outstanding unfinished trick on that list.
 *     If none, mark row 'cancelled'.
 *  3) Call notificationSender.send (which honors prefs + quiet hours).
 *  4) Mark row 'sent' (or 'failed' with attemptCount++).
 *
 * Daily (separate interval):
 *  - autoPauseStaleLists() pauses cadence for lists with no activity in 60d.
 *
 * Spec: docs/features/notifications.md §6.3
 */

const { ObjectId } = require('mongodb');
const notificationSender = require('../services/notificationSender');
const reminderPlanner = require('../services/reminderPlanner');

const TICK_MS = 5 * 60 * 1000; // 5 min
const DAILY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;
const MAX_ATTEMPTS = 3;

let _db = null;
let _tickTimer = null;
let _dailyTimer = null;
let _tickRunning = false;
let _dailyRunning = false;

function start(db, opts = {}) {
  _db = db;
  const tickMs = opts.tickMs ?? TICK_MS;
  const dailyMs = opts.dailyMs ?? DAILY_MS;

  if (_tickTimer) clearInterval(_tickTimer);
  if (_dailyTimer) clearInterval(_dailyTimer);

  // Stagger first tick so we don't slam DB during startup.
  setTimeout(() => tick().catch(logErr), 90 * 1000);
  _tickTimer = setInterval(() => tick().catch(logErr), tickMs);

  // Daily auto-pause: first run 2 minutes after boot, then every 24h.
  setTimeout(() => dailyJob().catch(logErr), 120 * 1000);
  _dailyTimer = setInterval(() => dailyJob().catch(logErr), dailyMs);

  console.log(
    `[reminderSender] started (tick ${Math.round(tickMs / 1000)}s · daily ${Math.round(dailyMs / 3600000)}h)`,
  );
}

function stop() {
  if (_tickTimer) clearInterval(_tickTimer);
  if (_dailyTimer) clearInterval(_dailyTimer);
  _tickTimer = null;
  _dailyTimer = null;
}

function logErr(err) {
  console.error('[reminderSender] error:', err?.message || err);
}

const COMPLETE_VALUES = new Set(['Complete', 'Completed']);

/**
 * Pick the longest-outstanding (oldest) unfinished trick from a list.
 * Returns null if everything's done. Tricks live denormalized on the list doc
 * with `_id` references; we don't need to hit the `tricks` collection here.
 */
async function pickReminderTrick(listId) {
  const list = await _db
    .collection('tricklists')
    .findOne({ _id: listId }, { projection: { name: 1, tricks: 1, user: 1 } });
  if (!list) return null;

  const tricks = (list.tricks || []).filter((t) => !COMPLETE_VALUES.has(t.checked || t.status));
  if (tricks.length === 0) return null;

  // Sort oldest first (createdAt asc); tricks without a date sink to the end.
  tricks.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return { list, trick: tricks[0] };
}

async function tick() {
  if (_tickRunning) return;
  _tickRunning = true;
  try {
    const now = new Date();
    const due = await _db
      .collection('scheduledNotifications')
      .find({ status: 'pending', scheduledFor: { $lte: now }, category: 'reminder' })
      .sort({ scheduledFor: 1 })
      .limit(BATCH_LIMIT)
      .toArray();

    if (due.length === 0) return;

    let sent = 0;
    let cancelled = 0;
    let failed = 0;

    for (const row of due) {
      // Claim the row before doing work so a re-entrant tick (shouldn't happen
      // due to the overlap guard, but cheap insurance) doesn't double-send.
      const claim = await _db
        .collection('scheduledNotifications')
        .findOneAndUpdate(
          { _id: row._id, status: 'pending' },
          { $set: { status: 'inflight', claimedAt: new Date() }, $inc: { attemptCount: 1 } },
          { returnDocument: 'after' },
        );
      if (!claim?.value) continue; // Someone else got it.

      try {
        const picked = await pickReminderTrick(row.listId);
        if (!picked) {
          await markStatus(row._id, 'cancelled', { cancelledReason: 'no-unfinished-tricks' });
          cancelled++;
          continue;
        }

        const trickName = picked.trick?.name || 'a trick';
        const listName = picked.list?.name || 'your list';
        const trickId = picked.trick?._id ? String(picked.trick._id) : null;

        const result = await notificationSender.send({
          userId: row.userId,
          category: 'reminders',
          title: 'Time to send it 🛹',
          body: `You've still got ${trickName} on ${listName} — go land it.`,
          threadId: `reminder-${String(row.listId)}`,
          channelId: 'reminders',
          interruptionLevel: 'active',
          data: {
            category: 'reminders',
            url: trickId
              ? `/(tabs)/trickbook/${trickId}?listId=${row.listId}&fromReminder=1`
              : `/(tabs)/trickbook?listId=${row.listId}&fromReminder=1`,
            listId: String(row.listId),
            trickId,
            idempotencyKey: row.idempotencyKey,
          },
        });

        if (result.skipped) {
          // Skipped because of prefs / quiet hours / no-tokens — record but don't fail.
          await markStatus(row._id, 'skipped', { skippedReason: result.skipped });
        } else {
          await markStatus(row._id, 'sent', { sentAt: new Date() });
          sent++;
        }
      } catch (err) {
        console.error('[reminderSender] send failed for row', String(row._id), err?.message);
        const finalStatus = (claim.value.attemptCount || 0) >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await markStatus(row._id, finalStatus, { lastError: err?.message || 'unknown' });
        if (finalStatus === 'failed') failed++;
      }
    }

    console.log(
      `[reminderSender] tick · due ${due.length} · sent ${sent} · cancelled ${cancelled} · failed ${failed}`,
    );
  } finally {
    _tickRunning = false;
  }
}

async function markStatus(_id, status, extra = {}) {
  await _db
    .collection('scheduledNotifications')
    .updateOne(
      { _id: _id instanceof ObjectId ? _id : new ObjectId(_id) },
      { $set: { status, ...extra, lastAttemptAt: new Date() } },
    );
}

async function dailyJob() {
  if (_dailyRunning) return;
  _dailyRunning = true;
  try {
    const paused = await reminderPlanner.autoPauseStaleLists();
    if (paused > 0) console.log(`[reminderSender] daily · auto-paused ${paused} stale lists`);
  } finally {
    _dailyRunning = false;
  }
}

module.exports = { start, stop, _tickNow: tick, _dailyNow: dailyJob };
