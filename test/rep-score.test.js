const assert = require('node:assert/strict');
const test = require('node:test');
const { CAPS, computeRepScore, placementPoints } = require('../services/riders/repScore');

const NOW = new Date('2026-09-07T00:00:00.000Z');

test('weights placements by finish', () => {
  assert.equal(placementPoints('1st'), 12);
  assert.equal(placementPoints('Winner'), 12);
  assert.equal(placementPoints('2nd'), 8);
  assert.equal(placementPoints('Runner-up'), 8);
  assert.equal(placementPoints('11th'), 4);
  assert.equal(placementPoints(undefined), 4);
});

test('scores an empty profile at zero', () => {
  const { score, breakdown } = computeRepScore({}, NOW);
  assert.equal(score, 0);
  assert.deepEqual(breakdown, { parts: 0, results: 0, social: 0, longevity: 0, evidence: 0 });
});

test('caps every component and the total', () => {
  const { score, breakdown } = computeRepScore(
    {
      couchCredits: new Array(5).fill({ filmId: 'x' }),
      videoParts: new Array(5).fill({}),
      notableResults: new Array(10).fill({ placement: '1st' }),
      socialLinks: new Array(4).fill({ platform: 'instagram', url: 'https://example.com' }),
      officialWebsite: 'https://example.com',
      activeYears: { from: 1990 },
      sourceEvidence: new Array(9).fill({ url: 'https://example.com' }),
    },
    NOW,
  );
  assert.deepEqual(breakdown, {
    parts: CAPS.parts,
    results: CAPS.results,
    social: CAPS.social,
    longevity: CAPS.longevity,
    evidence: CAPS.evidence,
  });
  assert.equal(score, 100);
});

test('scores a typical single-film profile', () => {
  const { score, breakdown } = computeRepScore(
    {
      couchCredits: [{ filmId: 'x' }],
      notableResults: [{ placement: 'Winner' }, { placement: '2nd' }, { placement: '11th' }],
      socialLinks: [{ platform: 'instagram', url: 'https://example.com' }],
      activeYears: { from: 2016 },
      sourceEvidence: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
    },
    NOW,
  );
  assert.deepEqual(breakdown, { parts: 15, results: 24, social: 5, longevity: 10, evidence: 2 });
  assert.equal(score, 56);
});
