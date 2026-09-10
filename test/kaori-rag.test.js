const assert = require('node:assert/strict');
const test = require('node:test');

const { DIMENSIONS, embed } = require('../kaori-rag/embedding');
const { SOURCES, makeDocument } = require('../kaori-rag/documents');

test('knowledge documents have stable identity, content, and hashes', () => {
  const first = makeDocument(
    'trick',
    { _id: 'abc', category: 'snowboarding' },
    'Backside 360',
    ['Intermediate', ['wind up', 'pop', 'spot landing']],
    'https://thetrickbook.com/trickipedia/snowboarding/backside-360',
  );
  const second = makeDocument(
    'trick',
    { _id: 'abc', category: 'snowboarding' },
    'Backside 360',
    ['Intermediate', ['wind up', 'pop', 'spot landing']],
    'https://thetrickbook.com/trickipedia/snowboarding/backside-360',
  );

  assert.equal(first.sourceId, 'abc');
  assert.match(first.content, /Backside 360/);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.contentHash.length, 64);
});

test('all Phase 2 knowledge sources are configured', () => {
  assert.deepEqual(
    SOURCES.map((source) => source.sourceType),
    ['trick', 'film', 'spot', 'event', 'rider'],
  );
});

test('embedding model returns normalized Atlas-compatible vectors', async () => {
  const vector = await embed('snowboard films featuring Forest Bailey');
  assert.equal(vector.length, DIMENSIONS);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(magnitude - 1) < 0.001);
});
