/**
 * One-time (idempotent) migration: normalize the `events` collection so the
 * date filters on GET /api/events actually work.
 *
 * Problem: startAt/endAt are stored as ISO *strings* on some sources and real
 * Date objects on others. Mongo range queries ({$gte: <Date now>}) don't
 * compare cleanly across BSON types, so past events leak into the "upcoming"
 * view and the upcoming/archive split fails.
 *
 * Fix: coerce startAt/endAt to real Date objects, and recompute `status` from
 * the dates using a single consistent vocab: scheduled | ongoing | completed.
 *
 * SAFE BY DEFAULT: runs a DRY RUN unless you pass --commit.
 *   node scripts/normalizeEventDates.js           # dry run, writes nothing
 *   node scripts/normalizeEventDates.js --commit   # apply changes
 */
const { MongoClient } = require('mongodb');

const COMMIT = process.argv.includes('--commit');

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function computeStatus(startAt, endAt, now) {
  const end = endAt || startAt;
  if (end && end < now) return 'completed';
  if (startAt && startAt <= now && end && end >= now) return 'ongoing';
  return 'scheduled';
}

async function main() {
  const uri = process.env.ATLAS_URI;
  if (!uri) throw new Error('ATLAS_URI not set');
  const client = new MongoClient(uri);
  await client.connect();
  const events = client.db('TrickList2').collection('events');

  const now = new Date();
  const cursor = events.find({});
  let scanned = 0;
  let dateFixes = 0;
  let statusFixes = 0;
  const ops = [];

  while (await cursor.hasNext()) {
    const e = await cursor.next();
    scanned += 1;
    const startAt = toDate(e.startAt);
    const endAt = toDate(e.endAt);
    const status = computeStatus(startAt, endAt, now);

    const set = {};
    const startWasString = typeof e.startAt === 'string';
    const endWasString = typeof e.endAt === 'string';
    if (startAt && startWasString) set.startAt = startAt;
    if (endAt && endWasString) set.endAt = endAt;
    if (startWasString || endWasString) dateFixes += 1;
    if (e.status !== status) {
      set.status = status;
      statusFixes += 1;
    }

    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: set } } });
    }
  }

  console.log(
    `[normalize] scanned=${scanned} dateFixes=${dateFixes} statusFixes=${statusFixes} pendingWrites=${ops.length}`,
  );
  if (!COMMIT) {
    console.log('[normalize] DRY RUN — no writes. Re-run with --commit to apply.');
  } else if (ops.length) {
    const res = await events.bulkWrite(ops, { ordered: false });
    console.log('[normalize] applied:', JSON.stringify(res.result || res));
  } else {
    console.log('[normalize] nothing to change.');
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
