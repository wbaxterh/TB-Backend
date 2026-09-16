#!/usr/bin/env node
require('dotenv').config();
const { connectToDatabase, closeDatabase } = require('../db');
const { createGraphClient } = require('../services/graph/client');
const { projectLandedTrick, projectTrick } = require('../services/graph/projector');

async function rebuild(db, graph, { clear = true } = {}) {
  if (!graph.enabled) throw new Error('Neo4j is not enabled/configured');
  await graph.run(
    'CREATE CONSTRAINT trick_source_id IF NOT EXISTS FOR (t:Trick) REQUIRE t.sourceId IS UNIQUE',
  );
  await graph.run(
    'CREATE CONSTRAINT rider_source_id IF NOT EXISTS FOR (r:Rider) REQUIRE r.sourceId IS UNIQUE',
  );
  if (clear) await graph.run('MATCH (n) WHERE n:Trick OR n:Rider DETACH DELETE n');

  const tricks = await db.collection('trickipedia').find({}).project({ _id: 1 }).toArray();
  for (const trick of tricks) await projectTrick(db, graph, String(trick._id));

  let landed = 0;
  const catalog = await db
    .collection('trickipedia')
    .find({})
    .project({ _id: 1, name: 1 })
    .toArray();
  const byName = new Map(
    catalog.map((item) => [
      String(item.name || '')
        .trim()
        .toLowerCase(),
      item,
    ]),
  );
  const lists = await db
    .collection('tricklists')
    .find({})
    .project({ user: 1, tricks: 1 })
    .toArray();
  for (const list of lists) {
    const riderId = list.user?.oid || list.user?.$id;
    if (!riderId) continue;
    const ids = (list.tricks || []).map((item) => item._id).filter(Boolean);
    if (!ids.length) continue;
    const personal = await db
      .collection('tricks')
      .find({ _id: { $in: ids }, checked: 'Landed' })
      .toArray();
    for (const item of personal) {
      const canonical = byName.get(
        String(item.name || '')
          .trim()
          .toLowerCase(),
      );
      if (!canonical) continue;
      await projectLandedTrick(graph, {
        riderId: String(riderId),
        trickId: String(canonical._id),
        trickName: canonical.name,
        landed: true,
      });
      landed += 1;
    }
  }
  return { tricks: tricks.length, landed };
}

async function main() {
  if (!process.argv.includes('--execute')) {
    throw new Error('Refusing to rebuild without --execute');
  }
  const db = await connectToDatabase();
  try {
    const result = await rebuild(db, createGraphClient(), {
      clear: !process.argv.includes('--no-clear'),
    });
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { rebuild };
