/**
 * Receipts poller — runs on an interval, fetches Expo push receipts for tickets
 * older than 30 minutes, and marks tokens dead when DeviceNotRegistered comes back.
 *
 * Expo retains receipts at least 24h; polling every 15 min keeps us comfortably
 * inside that window with low load.
 *
 * Spec: docs/docs/features/notifications.md §6.2
 */

const { _internals } = require('../services/notificationSender');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min
const RECEIPT_AGE_MIN_MS = 30 * 60 * 1000; // wait 30 min before first poll

let timer = null;
let _db = null;
let running = false;

function start(db, intervalMs = DEFAULT_INTERVAL_MS) {
  _db = db;
  if (timer) clearInterval(timer);
  // Stagger first run by 60s so we don't slam the DB during startup.
  setTimeout(() => poll().catch(logErr), 60 * 1000);
  timer = setInterval(() => poll().catch(logErr), intervalMs);
  console.log(`[receiptsPoller] started (interval ${Math.round(intervalMs / 1000)}s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function logErr(err) {
  console.error('[receiptsPoller] error:', err?.message || err);
}

async function poll() {
  if (running) return; // overlap guard
  running = true;
  try {
    const { expo, TICKETS_COLLECTION, TOKENS_COLLECTION } = _internals;
    const cutoff = new Date(Date.now() - RECEIPT_AGE_MIN_MS);

    const pending = await _db
      .collection(TICKETS_COLLECTION)
      .find({
        receiptStatus: 'pending',
        status: 'ok',
        ticketId: { $ne: null },
        createdAt: { $lte: cutoff },
      })
      .limit(2000) // Expo allows ~1000 receipts per request; we pull 2k worst-case per poll
      .toArray();

    if (pending.length === 0) return;

    const ticketIds = pending.map((p) => p.ticketId);
    const ticketIndex = new Map(pending.map((p) => [p.ticketId, p]));

    const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
    let processed = 0;
    let killed = 0;
    let errors = 0;

    for (const chunk of chunks) {
      let receipts;
      try {
        receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      } catch (err) {
        console.error('[receiptsPoller] getReceipts failed:', err?.message || err);
        continue;
      }

      const bulk = _db.collection(TICKETS_COLLECTION).initializeUnorderedBulkOp();
      const tokenKills = [];

      for (const id of chunk) {
        const r = receipts[id];
        const ticketDoc = ticketIndex.get(id);
        if (!r) continue; // not yet available; we'll try again next poll

        const update = { receiptStatus: r.status, receiptCheckedAt: new Date() };
        if (r.status === 'error') {
          update.receiptError = r.details?.error || r.message || 'unknown';
          errors++;
          if (r.details?.error === 'DeviceNotRegistered' && ticketDoc?.pushTokenId) {
            tokenKills.push(ticketDoc.pushTokenId);
          }
        }
        bulk.find({ ticketId: id }).updateOne({ $set: update });
        processed++;
      }

      try {
        if (bulk.length > 0) await bulk.execute();
      } catch (err) {
        console.error('[receiptsPoller] bulk update failed:', err?.message || err);
      }

      if (tokenKills.length) {
        const killRes = await _db
          .collection(TOKENS_COLLECTION)
          .updateMany(
            { _id: { $in: tokenKills }, deadAt: null },
            { $set: { deadAt: new Date(), deadReason: 'DeviceNotRegistered' } },
          );
        killed += killRes.modifiedCount || 0;
      }
    }

    console.log(
      `[receiptsPoller] polled ${ticketIds.length} tickets · processed ${processed} · errors ${errors} · tokens killed ${killed}`,
    );
  } finally {
    running = false;
  }
}

module.exports = { start, stop, _pollNow: poll };
