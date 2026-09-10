#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');
const graph = require('../companion-graph/graph');

async function main() {
  const [command, ...words] = process.argv.slice(2);
  const query = words.join(' ').trim();
  if (!command || (!query && command !== 'samples')) {
    throw new Error(
      'Usage: node scripts/query-companion-graph.js <films|spot|similar|path> <name> | samples',
    );
  }
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    const actions = {
      films: () => graph.filmsFeaturingTrick(db, query),
      path: () => graph.learningPath(db, query),
      samples: async () => {
        const edges = await db
          .collection(graph.EDGE_COLLECTION)
          .find({ relation: { $in: ['MENTIONS_TRICK', 'PERFORMED_AT'] } })
          .limit(30)
          .toArray();
        const spotIds = edges
          .filter((item) => item.to.type === 'Spot')
          .map((item) => new (require('mongodb').ObjectId)(item.to.id));
        const spots = spotIds.length
          ? await db
              .collection('spots')
              .find({ _id: { $in: spotIds } })
              .project({ name: 1 })
              .toArray()
          : [];
        const spotNames = new Map(spots.map((spot) => [String(spot._id), spot.name]));
        return edges.map((item) => ({
          relation: item.relation,
          from: item.from.label,
          to: item.to.label || spotNames.get(item.to.id),
        }));
      },
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
