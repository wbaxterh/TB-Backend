#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || process.env.DB_CONNECTION_STRING;
if (!uri) throw new Error('Set MONGODB_URI or DB_CONNECTION_STRING');

const published = (note, sourceUrl) => ({
  status: 'reviewed',
  confidence: 'medium',
  evidence: [
    {
      sourceUrl,
      sourceType: 'pro-tutorial',
      note,
      checkedAt: new Date('2026-08-31T22:45:00Z'),
    },
  ],
  reviewedBy: 'TrickBook editorial first pass',
  reviewedAt: new Date('2026-08-31T22:45:00Z'),
});

const edge = (name, reason, options = {}) => ({ name, reason, ...options });

const updates = {
  Ollie: {
    nextSteps: [
      edge('Frontside 180', 'Adds controlled aerial rotation to a stable ollie.'),
      edge('Pop Shove-It', 'Builds from pop timing while separating body and board rotation.'),
      edge('Kickflip', 'Adds a front-foot flick to the ollie pop and leveling motion.'),
      edge('50-50 Grind', 'Uses ollie height and accurate bolt placement to reach a ledge.'),
      edge('Boardslide', 'Uses an ollie plus a controlled quarter turn onto an obstacle.'),
    ],
    related: [edge('Switch Ollie', 'The same foundation performed in switch stance.', { relation: 'variation' })],
  },
  'Pop Shove-It': {
    prerequisites: [edge('Ollie', 'Provides pop timing, jumping confidence, and centered landings.', { strength: 'recommended' })],
    nextSteps: [
      edge('Backside Bigspin', 'Combines the shove motion with a backside body rotation.'),
      edge('Varial Kickflip', 'Combines a backside shove with a kickflip.'),
      edge('Tre Flip (360 Flip)', 'Develops the back-foot scoop that later becomes a 360 rotation.', { strength: 'helpful' }),
    ],
    related: [
      edge('Frontside Pop Shove It', 'The board rotates in the opposite direction.', { relation: 'opposite-direction' }),
      edge('Backside Pop Shove-it', 'A naming-specific record for the same backside shove family.', { relation: 'same-family' }),
    ],
  },
  'Frontside 180': {
    prerequisites: [edge('Ollie', 'A consistent ollie makes the rotation controlled instead of pivoted.', { strength: 'recommended' })],
    nextSteps: [
      edge('Frontside Bigspin', 'Extends the frontside body rotation while adding board rotation.'),
      edge('Frontside Pop Shove It', 'Builds control of the same rotational direction without turning the body.'),
    ],
    related: [edge('Backside 180', 'The opposite-direction aerial 180.', { relation: 'opposite-direction' })],
  },
  Kickflip: {
    prerequisites: [edge('Ollie', 'Supplies the pop, front-foot path, airtime, and centered landing.', { strength: 'recommended' })],
    nextSteps: [
      edge('Varial Kickflip', 'Combines the kickflip with a backside shove.'),
      edge('Tre Flip (360 Flip)', 'Reuses flick, board tracking, and catch control with a stronger scoop.'),
    ],
    related: [
      edge('Heelflip', 'The board flips along the same axis from the opposite side.', { relation: 'opposite-direction' }),
      edge('Nollie Kickflip', 'A kickflip initiated from the nose in nollie stance.', { relation: 'variation' }),
      edge('Hardflip', 'Combines kickflip rotation with a frontside shove.', { relation: 'combination' }),
    ],
  },
  Boardslide: {
    prerequisites: [
      edge('Ollie', 'Provides enough clearance to place the board over a low rail or ledge.', { strength: 'recommended' }),
      edge('Frontside 180', 'Builds controlled quarter-turn shoulder and board alignment.', { strength: 'helpful' }),
    ],
    nextSteps: [
      edge('Lipslide', 'Takes the same slide position over the far side of the obstacle.'),
      edge('Bluntslide', 'Advances obstacle clearance and tail lock-in beyond a boardslide.'),
    ],
    related: [
      edge('50-50 Grind', 'A foundational obstacle trick with both trucks locked on.', { relation: 'same-family' }),
      edge('Noseslide', 'A slide using the nose rather than the center of the deck.', { relation: 'same-family' }),
    ],
  },
  '50-50 Grind': {
    prerequisites: [edge('Ollie', 'Requires controlled height and both trucks placed accurately.', { strength: 'recommended' })],
    nextSteps: [
      edge('5-0 Grind', 'Moves from two-truck balance to a rear-truck manual position.'),
      edge('Nosegrind', 'Transfers lock-in and balance to the front truck.'),
      edge('Smith Grind', 'Adds a dipped front truck and more demanding lock-in.'),
      edge('Feeble Grind', 'Adds an outside rear-truck lock with the front truck below the obstacle.'),
    ],
    related: [edge('Axle Stall', 'The transition stall counterpart with both trucks on coping.', { relation: 'terrain-transfer' })],
  },
  'Drop In': {
    nextSteps: [
      edge('Rock to Fakie', 'Adds a controlled coping touch and fakie return after transition confidence.'),
      edge('Axle Stall', 'Adds a turn and two-truck coping lock before re-entry.'),
    ],
    related: [edge('Kickturn', 'Builds transition turning and weight-transfer confidence.', { relation: 'same-family' })],
  },
  'Tre Flip (360 Flip)': {
    prerequisites: [
      edge('Kickflip', 'Builds flick, flip tracking, and catch control.', { strength: 'recommended' }),
      edge('Pop Shove-It', 'Builds the scoop path and confidence staying above a rotating board.', { strength: 'helpful' }),
    ],
    related: [
      edge('Varial Kickflip', 'Uses the same kickflip-and-shove combination with 180 degrees of board rotation.', { relation: 'same-family' }),
      edge('Backside Bigspin', 'Shares a strong backside scoop and 360-degree board rotation.', { relation: 'same-family' }),
      edge('Laser Flip', 'The opposite flip-and-scoop combination.', { relation: 'opposite-direction' }),
    ],
  },
};

const sourceUrl = 'https://docs.thetrickbook.com/docs/roadmap/trickipedia-network-first-pass';

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'TrickList');
    const collection = db.collection('trickipedia');
    const names = [...new Set(Object.entries(updates).flatMap(([name, groups]) => [name, ...Object.values(groups).flat().map((item) => item.name)]))];
    const records = await collection.find({ name: { $in: names }, category: 'Skateboarding' }).toArray();
    const byName = new Map(records.map((record) => [record.name, record]));
    const missing = names.filter((name) => !byName.has(name));
    if (missing.length) throw new Error(`Missing referenced tricks: ${missing.join(', ')}`);

    const operations = Object.entries(updates).map(([name, groups]) => {
      const progression = Object.fromEntries(
        Object.entries(groups).map(([group, edges]) => [
          group,
          edges.map(({ name: targetName, ...item }, order) => ({
            ...item,
            trickId: byName.get(targetName)._id,
            order,
            research: published(item.reason, sourceUrl),
          })),
        ]),
      );
      return {
        updateOne: {
          filter: { _id: byName.get(name)._id },
          update: { $set: { progression, 'audit.networkReviewedAt': new Date(), updatedAt: new Date() } },
        },
      };
    });

    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({ dryRun: true, targets: Object.keys(updates), operations: operations.length }, null, 2));
      return;
    }
    const result = await collection.bulkWrite(operations, { ordered: true });
    console.log(JSON.stringify({ dryRun: false, matched: result.matchedCount, modified: result.modifiedCount }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
