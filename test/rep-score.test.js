const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CAPS,
  computeRepScore,
  computeResultsScore,
  placementPoints,
} = require('../services/riders/repScore');

const NOW = new Date('2026-09-07T00:00:00.000Z');

test('weights placements by finish with graded points', () => {
  assert.equal(placementPoints('1st'), 12);
  assert.equal(placementPoints('Winner'), 12);
  assert.equal(placementPoints('champion'), 12);
  assert.equal(placementPoints('gold'), 12);
  assert.equal(placementPoints('2nd'), 8);
  assert.equal(placementPoints('3rd'), 8);
  assert.equal(placementPoints('Runner-up'), 8);
  assert.equal(placementPoints('silver'), 8);
  assert.equal(placementPoints('bronze'), 8);
  assert.equal(placementPoints('4th'), 6);
  assert.equal(placementPoints('5th'), 6);
  assert.equal(placementPoints('10th'), 6);
  assert.equal(placementPoints('top 10'), 6);
  assert.equal(placementPoints('finalist'), 6);
  assert.equal(placementPoints('11th'), 4);
  assert.equal(placementPoints('20th'), 4);
  assert.equal(placementPoints(undefined), 4);
});

test('derives placement from placementNumber when text is absent', () => {
  assert.equal(placementPoints(undefined, 1), 12);
  assert.equal(placementPoints(undefined, 2), 8);
  assert.equal(placementPoints(undefined, 3), 8);
  assert.equal(placementPoints(undefined, 4), 6);
  assert.equal(placementPoints(undefined, 10), 6);
  assert.equal(placementPoints(undefined, 11), 4);
  assert.equal(placementPoints('', 1), 12);
  assert.equal(placementPoints('', 5), 6);
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
      notableResults: new Array(10)
        .fill({ placement: '1st' })
        .map((r, i) => ({ ...r, event: `Event${i}`, year: 2010 + i })),
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
      notableResults: [
        { event: 'X Games', year: 2020, placement: 'Winner' },
        { event: 'SLS', year: 2021, placement: '2nd' },
        { event: 'Dew Tour', year: 2022, placement: '11th' },
      ],
      socialLinks: [{ platform: 'instagram', url: 'https://example.com' }],
      activeYears: { from: 2016 },
      sourceEvidence: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
    },
    NOW,
  );
  assert.deepEqual(breakdown, { parts: 15, results: 24, social: 5, longevity: 10, evidence: 2 });
  assert.equal(score, 56);
});

test('includes contestHistory placements in results score', () => {
  const results = computeResultsScore({
    contestHistory: [
      { contest: 'X Games', year: 2020, medal: 'gold' },
      { contest: 'SLS', year: 2021, placementText: '2nd' },
      { contest: 'Dew Tour', year: 2022, placementNumber: 5 },
    ],
  });
  assert.equal(results, 12 + 8 + 6);
});

test('contestHistory medal values map to correct points', () => {
  assert.equal(computeResultsScore({ contestHistory: [{ contest: 'A', medal: 'gold' }] }), 12);
  assert.equal(computeResultsScore({ contestHistory: [{ contest: 'B', medal: 'silver' }] }), 8);
  assert.equal(computeResultsScore({ contestHistory: [{ contest: 'C', medal: 'bronze' }] }), 8);
  assert.equal(computeResultsScore({ contestHistory: [{ contest: 'D', medal: 'none' }] }), 4);
});

test('deduplicates entries with same event/year across notableResults and contestHistory', () => {
  const results = computeResultsScore({
    notableResults: [
      { event: 'X Games', year: 2020, placement: '1st' },
      { event: 'SLS', year: 2021, placement: '2nd' },
    ],
    contestHistory: [
      { contest: 'X Games', year: 2020, medal: 'gold' },
      { contest: 'Dew Tour', year: 2022, placementText: '3rd' },
    ],
  });
  assert.equal(results, 12 + 8 + 8);
});

test('deduplication normalizes event names (case-insensitive, ignores punctuation)', () => {
  const results = computeResultsScore({
    notableResults: [{ event: 'X-Games Minneapolis', year: 2020, placement: '1st' }],
    contestHistory: [{ contest: 'X Games Minneapolis', year: 2020, medal: 'gold' }],
  });
  assert.equal(results, 12);
});

test('entries without year are deduplicated separately', () => {
  const results = computeResultsScore({
    notableResults: [
      { event: 'X Games', placement: '1st' },
      { event: 'X Games', year: 2020, placement: '2nd' },
    ],
    contestHistory: [{ contest: 'X Games', medal: 'gold' }],
  });
  assert.equal(results, 12 + 8);
});

test('results score still caps at 35 with combined sources', () => {
  const results = computeResultsScore({
    notableResults: new Array(5).fill({ event: 'Event', placement: '1st' }).map((r, i) => ({
      ...r,
      event: `Event${i}`,
      year: 2020 + i,
    })),
    contestHistory: new Array(5).fill({ contest: 'Contest', medal: 'gold' }).map((r, i) => ({
      ...r,
      contest: `Contest${i}`,
      year: 2020 + i,
    })),
  });
  assert.equal(results, CAPS.results);
});

test('computeRepScore integrates contestHistory into total score', () => {
  const { score, breakdown } = computeRepScore(
    {
      contestHistory: [
        { contest: 'Olympics', year: 2024, medal: 'gold' },
        { contest: 'X Games', year: 2023, placementText: '2nd' },
      ],
    },
    NOW,
  );
  assert.equal(breakdown.results, 20);
  assert.equal(score, 20);
});

test('placementNumber alone scores correctly in contestHistory', () => {
  const results = computeResultsScore({
    contestHistory: [
      { contest: 'Event A', year: 2020, placementNumber: 1 },
      { contest: 'Event B', year: 2020, placementNumber: 3 },
      { contest: 'Event C', year: 2020, placementNumber: 7 },
      { contest: 'Event D', year: 2020, placementNumber: 15 },
    ],
  });
  assert.equal(results, 12 + 8 + 6 + 4);
});
