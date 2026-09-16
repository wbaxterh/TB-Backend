const crypto = require('node:crypto');

const COLLECTION = 'graph_outbox';

function stableEventId(type, aggregateId, version) {
  return crypto.createHash('sha256').update(`${type}:${aggregateId}:${version}`).digest('hex');
}

async function ensureOutboxIndexes(db) {
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ eventId: 1 }, { unique: true });
  await collection.createIndex({ status: 1, availableAt: 1, createdAt: 1 });
}

async function enqueueGraphEvent(db, { type, aggregateType, aggregateId, version, payload = {} }) {
  const eventId = stableEventId(type, String(aggregateId), String(version));
  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        type,
        aggregateType,
        aggregateId: String(aggregateId),
        version,
        payload,
        status: 'pending',
        attempts: 0,
        availableAt: now,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return eventId;
}

async function enqueueGraphEventBestEffort(db, event) {
  try {
    return await enqueueGraphEvent(db, event);
  } catch (error) {
    console.error('[graph] unable to enqueue projection event:', error.message);
    return null;
  }
}

module.exports = {
  COLLECTION,
  enqueueGraphEvent,
  enqueueGraphEventBestEffort,
  ensureOutboxIndexes,
  stableEventId,
};
