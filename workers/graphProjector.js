const { COLLECTION, ensureOutboxIndexes } = require('../services/graph/outbox');
const { createGraphClient } = require('../services/graph/client');
const { projectEvent } = require('../services/graph/projector');

let timer;
let running = false;

async function processBatch(db, graph = createGraphClient(), limit = 25) {
  if (!graph.enabled || running) return { processed: 0, disabled: !graph.enabled };
  running = true;
  let processed = 0;
  try {
    const events = await db
      .collection(COLLECTION)
      .find({ status: 'pending', availableAt: { $lte: new Date() } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
    for (const event of events) {
      try {
        await projectEvent(db, graph, event);
        await db
          .collection(COLLECTION)
          .updateOne(
            { _id: event._id, status: 'pending' },
            { $set: { status: 'processed', processedAt: new Date() }, $inc: { attempts: 1 } },
          );
        processed += 1;
      } catch (error) {
        const attempts = (event.attempts || 0) + 1;
        const delayMs = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8));
        await db.collection(COLLECTION).updateOne(
          { _id: event._id },
          {
            $set: {
              status: attempts >= 10 ? 'dead' : 'pending',
              availableAt: new Date(Date.now() + delayMs),
              lastError: String(error.message || error).slice(0, 1000),
            },
            $inc: { attempts: 1 },
          },
        );
      }
    }
    return { processed, disabled: false };
  } finally {
    running = false;
  }
}

async function start(db) {
  const graph = createGraphClient();
  if (!graph.enabled) return;
  await ensureOutboxIndexes(db);
  const intervalMs = Math.max(
    1000,
    Number.parseInt(process.env.GRAPH_PROJECTOR_INTERVAL_MS, 10) || 5000,
  );
  timer = setInterval(
    () => processBatch(db, graph).catch((error) => console.error('[graph] projector:', error)),
    intervalMs,
  );
  timer.unref();
  processBatch(db, graph).catch((error) => console.error('[graph] initial projector:', error));
}

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

module.exports = { processBatch, start, stop };
