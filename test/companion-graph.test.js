const assert = require('node:assert/strict');
const test = require('node:test');

const { cosine, edge, mentions } = require('../scripts/build-companion-graph');

test('graph edge ids are stable and evidence-aware', () => {
  const from = { type: 'Film', id: 'film-1', label: 'Atlas 2' };
  const to = { type: 'Trick', id: 'trick-1', label: 'Backside 360' };
  const first = edge(from, 'MENTIONS_TRICK', to, { evidenceKey: 'backside 360' });
  const second = edge(from, 'MENTIONS_TRICK', to, { evidenceKey: 'backside 360' });
  const different = edge(from, 'MENTIONS_TRICK', to, { evidenceKey: 'back 3' });
  assert.equal(first._id, second._id);
  assert.notEqual(first._id, different._id);
});

test('explicit trick mentions require word boundaries and useful names', () => {
  assert.equal(mentions('A clean backside 360 in the ender', 'Backside 360'), true);
  assert.equal(mentions('The rider was airing over the hip', 'air'), false);
  assert.equal(mentions('A frontside boardslide', 'boardslide'), true);
  assert.equal(mentions('A dashboard slide', 'boardslide'), false);
  assert.equal(mentions('A trip through Japan', 'Japan Grab'), false);
});

test('cosine scores normalized embedding similarity', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});
