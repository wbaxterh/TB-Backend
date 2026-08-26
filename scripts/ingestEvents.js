/**
 * Event ingestion runner.
 *   node scripts/ingestEvents.js            # all sources
 *   node scripts/ingestEvents.js xgames     # specific source(s)
 *
 * Idempotent — safe to run on a cron. Uses the same Mongo connection the app
 * uses (db name TrickList2).
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { ingestEvents } = require('../services/events/ingest');

async function main() {
  const sources = process.argv.slice(2).filter(Boolean);
  const uri = process.env.ATLAS_URI;
  if (!uri) throw new Error('ATLAS_URI not set');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('TrickList2');
  try {
    const summary = await ingestEvents(db, sources.length ? { sources } : {});
    console.log('INGEST SUMMARY:', JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
