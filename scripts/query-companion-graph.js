#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');
const graph = require('../companion-graph/graph');

async function main() {
  const [command, ...words] = process.argv.slice(2);
  const query = words.join(' ').trim();
  if (!command || !query) {
    throw new Error(
      'Usage: node scripts/query-companion-graph.js <films|spot|similar|path> <name>',
    );
  }
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    const actions = {
      films: () => graph.filmsFeaturingTrick(db, query),
      path: () => graph.learningPath(db, query),
      similar: () => graph.similarTricks(db, query),
      spot: () => graph.tricksAtSpot(db, query),
    };
    if (!actions[command]) throw new Error(`Unknown command: ${command}`);
    console.log(JSON.stringify(await actions[command](), null, 2));
  } finally {
    await client.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('[Companion Graph] query failed:', error);
    process.exit(1);
  },
);
