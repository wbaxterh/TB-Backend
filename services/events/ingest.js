/**
 * Event ingestion orchestrator. Runs each source, normalizes, and upserts into
 * the `events` collection keyed by a stable dedupeKey. Idempotent: safe to run
 * on a schedule.
 */
const crypto = require('node:crypto');
const { fetchXGamesEvents } = require('./xgames');
const { fetchBoardrEvents } = require('./boardr');
const { fetchOfficialEvents } = require('./official');

const SOURCES = {
  xgames: fetchXGamesEvents,
  boardr: fetchBoardrEvents,
  official: fetchOfficialEvents,
};

function shortHash(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 6);
}

async function ensureIndexes(collection) {
  await collection.createIndex({ dedupeKey: 1 }, { unique: true }).catch(() => {});
  await collection.createIndex({ slug: 1 }, { unique: true }).catch(() => {});
  await collection.createIndex({ startAt: 1 }).catch(() => {});
  await collection.createIndex({ sports: 1 }).catch(() => {});
  await collection.createIndex({ status: 1 }).catch(() => {});
}

async function ingestEvents(db, { sources = ['xgames', 'boardr', 'official'] } = {}) {
  const collection = db.collection('events');
  await ensureIndexes(collection);

  const perSource = {};
  const all = [];
  for (const src of sources) {
    const fetcher = SOURCES[src];
    if (!fetcher) continue;
    try {
      const events = await fetcher();
      perSource[src] = events.length;
      all.push(...events);
    } catch (err) {
      console.error(`[events:ingest] source "${src}" failed:`, err.message);
      perSource[src] = 0;
    }
  }

  const now = new Date();
  let upserted = 0;
  for (const ev of all) {
    // Deterministic unique slug (base + hash of dedupeKey) → stable detail URLs.
    const slug = `${ev.slug}-${shortHash(ev.dedupeKey)}`;
    const { dedupeKey, ...rest } = ev;
    try {
      await collection.updateOne(
        { dedupeKey },
        {
          $set: { ...rest, slug, dedupeKey, updatedAt: now, lastSeenAt: now },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      upserted += 1;
    } catch (err) {
      console.error(`[events:ingest] upsert failed for "${ev.title}":`, err.message);
    }
  }

  const summary = { perSource, fetched: all.length, upserted };
  console.log('[events:ingest] done', JSON.stringify(summary));
  return summary;
}

module.exports = { ingestEvents };
