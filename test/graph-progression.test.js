const assert = require('node:assert/strict');
const test = require('node:test');
const { ObjectId } = require('mongodb');
const { createGraphClient, graphEnabled } = require('../services/graph/client');
const { stableEventId } = require('../services/graph/outbox');
const { mongoRecommendations } = require('../services/graph/recommendations');

test('graph client stays disabled until every credential is configured', () => {
  assert.equal(graphEnabled({ NEO4J_ENABLED: 'true' }), false);
  assert.equal(
    graphEnabled({
      NEO4J_ENABLED: 'true',
      NEO4J_URI: 'http://neo4j',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'secret',
    }),
    true,
  );
});

test('graph client sends parameterized Cypher and reads rows', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return { results: [{ data: [{ row: ['trick-1'] }] }], errors: [] };
      },
    };
  };
  const graph = createGraphClient(
    {
      NEO4J_ENABLED: 'true',
      NEO4J_URI: 'http://neo4j:7474',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'secret',
      NEO4J_DATABASE: 'staging',
    },
    fetchImpl,
  );
  assert.deepEqual(await graph.run('RETURN $id', { id: 'trick-1' }), [['trick-1']]);
  assert.equal(request.url, 'http://neo4j:7474/db/staging/tx/commit');
  assert.equal(JSON.parse(request.options.body).statements[0].parameters.id, 'trick-1');
});

test('outbox event ids are stable per aggregate version', () => {
  assert.equal(
    stableEventId('trick.upserted', '1', 'v1'),
    stableEventId('trick.upserted', '1', 'v1'),
  );
  assert.notEqual(
    stableEventId('trick.upserted', '1', 'v1'),
    stableEventId('trick.upserted', '1', 'v2'),
  );
});

function cursor(items) {
  return {
    project() {
      return this;
    },
    async toArray() {
      return items;
    },
  };
}

test('Mongo fallback recommends a reviewed next step from a landed trick', async () => {
  const landedId = new ObjectId();
  const nextId = new ObjectId();
  const personalId = new ObjectId();
  const db = {
    collection(name) {
      if (name === 'tricklists')
        return {
          find: () => cursor([{ user: { $id: 'rider-1' }, tricks: [{ _id: personalId }] }]),
        };
      if (name === 'tricks')
        return { find: () => cursor([{ _id: personalId, name: 'Ollie', checked: 'Landed' }]) };
      if (name === 'trickipedia') {
        return {
          find: () =>
            cursor([
              {
                _id: landedId,
                name: 'Ollie',
                category: 'skateboarding',
                progression: {
                  nextSteps: [{ trickId: nextId, research: { status: 'published' } }],
                },
              },
              {
                _id: nextId,
                name: 'Frontside 180',
                category: 'skateboarding',
                difficulty: 'Beginner',
              },
            ]),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  const items = await mongoRecommendations(db, 'rider-1', 'skateboarding', 5);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Frontside 180');
  assert.equal(items[0].score, 2);
});
