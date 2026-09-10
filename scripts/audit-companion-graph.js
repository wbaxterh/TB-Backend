#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');

const COLLECTIONS = [
  'trickipedia',
  'couch_videos',
  'spots',
  'events',
  'riders',
  'spot_trick_history',
  'posts',
];

async function main() {
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    for (const name of COLLECTIONS) {
      const collection = db.collection(name);
      const [count, sample] = await Promise.all([
        collection.countDocuments(),
        collection.findOne(),
      ]);
      console.log(
        JSON.stringify({
          collection: name,
          count,
          sampleFields: sample ? Object.keys(sample).sort() : [],
        }),
      );
    }
    const [progression, filmTricks, linkedPosts, spotHistory] = await Promise.all([
      db.collection('trickipedia').countDocuments({
        $or: [
          { 'progression.prerequisites.0': { $exists: true } },
          { 'progression.nextSteps.0': { $exists: true } },
        ],
      }),
      db.collection('couch_videos').countDocuments({
        $or: [{ 'trickIds.0': { $exists: true } }, { 'tricks.0': { $exists: true } }],
      }),
      db
        .collection('posts')
        .countDocuments({ 'trickIds.0': { $exists: true }, spotId: { $ne: null } }),
      db.collection('spot_trick_history').countDocuments(),
    ]);
    console.log(JSON.stringify({ progression, filmTricks, linkedPosts, spotHistory }));
  } finally {
    await client.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
