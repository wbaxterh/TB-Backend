const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateCase, hitMatches, summarize } = require('../kaori-rag/evaluate');

const expected = { sourceTypes: ['film'], anyText: ['Forest Bailey'] };
const matchingHit = {
  sourceType: 'film',
  title: 'A Forest Bailey part',
  webUrl: 'https://thetrickbook.com/media/couch/forest-part',
};

test('golden expectations require both source type and matching content', () => {
  assert.equal(hitMatches(matchingHit, expected), true);
  assert.equal(hitMatches({ ...matchingHit, sourceType: 'event' }, expected), false);
  assert.equal(hitMatches({ ...matchingHit, title: 'Different rider' }, expected), false);
});

test('evaluation reports link coverage and pass state', () => {
  const result = evaluateCase({ id: 'film', query: 'Forest?', expected }, [matchingHit], 42);
  assert.equal(result.passed, true);
  assert.equal(result.linkCoverage, 1);
  assert.equal(result.latencyMs, 42);
});

test('summary reports recall and latency without hiding misses', () => {
  const summary = summarize([
    { passed: true, linkCoverage: 1, latencyMs: 10 },
    { passed: false, linkCoverage: 0, latencyMs: 30 },
  ]);
  assert.equal(summary.recallAt5, 0.5);
  assert.equal(summary.averageLinkCoverage, 0.5);
  assert.equal(summary.averageLatencyMs, 20);
  assert.equal(summary.p95LatencyMs, 30);
});
