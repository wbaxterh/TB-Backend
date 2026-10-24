const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertEnrichmentEnvironment,
  computeFieldChanges,
  dedupeContestHistory,
  dedupeNotableResults,
  dedupeSocialLinks,
  dedupeStringArray,
  enrichEditorialRiderBatch,
  payloadHash,
  validateEnrichmentPayload,
} = require('../services/riders/editorialRiderEnricher');

const NOW = new Date('2026-09-10T10:00:00.000Z');

function existingRider(overrides = {}) {
  return {
    _id: 'rider-id-1',
    slug: 'tony-hawk-skateboarding',
    canonicalName: 'Tony Hawk',
    primarySport: 'skateboarding',
    biography: 'Legendary skateboarder known for the 900.',
    reviewStatus: 'published',
    nationality: 'American',
    homeRegion: '',
    officialWebsite: null,
    stance: 'goofy',
    ridingStyle: '',
    competitiveStatus: 'unknown',
    sponsors: ['Birdhouse', 'Vans'],
    socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/tonyhawk' }],
    contestHistory: [],
    notableResults: [{ event: 'X Games', year: 1999, placement: '1st' }],
    videoParts: [],
    couchCredits: [],
    sourceEvidence: [{ url: 'https://example.com/source1' }],
    teams: [],
    disciplines: ['vert', 'street'],
    signatureTricks: ['900'],
    contributions: [],
    aliases: [],
    heroImage: null,
    profileImage: null,
    activeYears: null,
    ...overrides,
  };
}

test('locks ordinary enrichments to staging and requires complete production canary evidence', () => {
  assert.equal(assertEnrichmentEnvironment({ databaseName: 'TrickList2Staging' }), 'staging');
  assert.throws(() => assertEnrichmentEnvironment({ databaseName: 'TrickList2' }), /locked/);
  assert.throws(
    () => assertEnrichmentEnvironment({ databaseName: 'TrickList2', production: true }),
    /canary evidence/,
  );
  assert.equal(
    assertEnrichmentEnvironment({
      databaseName: 'TrickList2',
      production: true,
      canary: {
        environment: 'staging',
        enrichedCount: 3,
        apiVerified: true,
        stagingCommit: 'a'.repeat(40),
        verifiedAt: NOW.toISOString(),
      },
    }),
    'production',
  );
});

test('validates enrichment payload structure and batch size limits', () => {
  assert.throws(
    () => validateEnrichmentPayload({ batchId: 'test', riders: [] }, NOW),
    /at least one rider/,
  );

  const tooMany = Array.from({ length: 20 }, (_, i) => ({ slug: `rider-${i}` }));
  assert.throws(
    () => validateEnrichmentPayload({ batchId: 'test', riders: tooMany }, NOW),
    /15-rider limit/,
  );

  assert.throws(
    () => validateEnrichmentPayload({ riders: [{ slug: 'test-rider' }] }, NOW),
    /batchId is required/,
  );

  assert.throws(
    () => validateEnrichmentPayload({ batchId: 'test', riders: [{}] }, NOW),
    /requires a slug/,
  );

  assert.throws(
    () => validateEnrichmentPayload({ batchId: 'test', riders: [{ slug: 'Invalid Slug' }] }, NOW),
    /Invalid slug format/,
  );

  const { batchId, enrichments } = validateEnrichmentPayload(
    { batchId: 'batch-1', riders: [{ slug: 'tony-hawk-skateboarding', sponsors: ['Nike'] }] },
    NOW,
  );
  assert.equal(batchId, 'batch-1');
  assert.equal(enrichments.length, 1);
  assert.equal(enrichments[0].slug, 'tony-hawk-skateboarding');
});

test('dedupes string arrays by normalized form', () => {
  const existing = ['Nike', 'Adidas'];
  const incoming = ['nike', 'Puma', 'ADIDAS'];
  const result = dedupeStringArray(existing, incoming);
  assert.deepEqual(result, ['Nike', 'Adidas', 'Puma']);
});

test('dedupes social links by platform', () => {
  const existing = [{ platform: 'instagram', url: 'https://instagram.com/old' }];
  const incoming = [
    { platform: 'Instagram', url: 'https://instagram.com/new' },
    { platform: 'twitter', url: 'https://twitter.com/new' },
  ];
  const result = dedupeSocialLinks(existing, incoming);
  assert.equal(result.length, 2);
  assert.equal(result.find((l) => l.platform === 'instagram').url, 'https://instagram.com/old');
  assert.equal(result.find((l) => l.platform === 'twitter').url, 'https://twitter.com/new');
});

test('dedupes contest history by composite key', () => {
  const existing = [{ contest: 'X Games', year: 2020, division: 'pro', placementNumber: 1 }];
  const incoming = [
    { contest: 'X Games', year: 2020, division: 'pro', placementNumber: 1 },
    { contest: 'X Games', year: 2021, division: 'pro', placementNumber: 2 },
  ];
  const result = dedupeContestHistory(existing, incoming);
  assert.equal(result.length, 2);
});

test('dedupes notable results by composite key', () => {
  const existing = [{ event: 'X Games', year: 1999, placement: '1st' }];
  const incoming = [
    { event: 'X Games', year: 1999, placement: '1st' },
    { event: 'X Games', year: 2000, placement: '2nd' },
  ];
  const result = dedupeNotableResults(existing, incoming);
  assert.equal(result.length, 2);
});

test('computes field changes for empty scalar fields only', () => {
  const rider = existingRider();
  const enrichment = {
    nationality: 'Canadian',
    homeRegion: 'California',
    officialWebsite: 'https://tonyhawk.com',
    stance: 'regular',
  };

  const { changes, skipped } = computeFieldChanges(rider, enrichment, {}, NOW);

  assert.equal(changes.homeRegion.to, 'California');
  assert.equal(changes.officialWebsite.to, 'https://tonyhawk.com/');
  assert.equal(skipped.nationality, 'field already populated');
  assert.equal(skipped.stance, 'field already populated');
});

test('computes array field changes with deduplication', () => {
  const rider = existingRider();
  const enrichment = {
    sponsors: ['Nike', 'Birdhouse', 'Element'],
    socialLinks: [
      { platform: 'twitter', url: 'https://twitter.com/tonyhawk' },
      { platform: 'instagram', url: 'https://instagram.com/different' },
    ],
    notableResults: [
      { event: 'X Games', year: 1999, placement: '1st' },
      { event: 'Dew Tour', year: 2005, placement: '1st' },
    ],
  };

  const { changes } = computeFieldChanges(rider, enrichment, {}, NOW);

  assert.equal(changes.sponsors.added, 2);
  assert.equal(changes.sponsors.newTotal, 4);
  assert.equal(changes.socialLinks.added, 1);
  assert.equal(changes.notableResults.added, 1);
});

test('respects override flags for populated fields', () => {
  const rider = existingRider();
  const enrichment = {
    nationality: 'Canadian',
    competitiveStatus: 'pro',
  };

  const withoutOverride = computeFieldChanges(rider, enrichment, {}, NOW);
  assert.equal(withoutOverride.skipped.nationality, 'field already populated');

  const withOverride = computeFieldChanges(rider, enrichment, { nationality: true }, NOW);
  assert.equal(withOverride.changes.nationality.to, 'Canadian');
});

test('protects biography and identity fields without explicit override', () => {
  const rider = existingRider();
  const enrichment = {
    biography: 'New biography text',
    canonicalName: 'Anthony Hawk',
    primarySport: 'snowboarding',
  };

  const { skipped } = computeFieldChanges(rider, enrichment, {}, NOW);

  assert.equal(skipped.biography, 'protected field');
  assert.equal(skipped.canonicalName, 'protected field');
  assert.equal(skipped.primarySport, 'protected field');
});

test('validates contest history entries', () => {
  const rider = existingRider();
  const enrichment = {
    contestHistory: [
      {
        contest: 'X Games',
        series: 'Summer X Games',
        year: 2020,
        location: 'Minneapolis, MN',
        sport: 'skateboarding',
        discipline: 'vert',
        division: 'pro',
        placementNumber: 1,
        placementText: '1st',
        medal: 'gold',
        sourceUrl: 'https://xgames.com/results',
        publisher: 'ESPN',
      },
    ],
  };

  const { changes } = computeFieldChanges(rider, enrichment, {}, NOW);

  assert.equal(changes.contestHistory.added, 1);
  const entry = changes.contestHistory.value[0];
  assert.equal(entry.contest, 'X Games');
  assert.equal(entry.division, 'pro');
  assert.equal(entry.medal, 'gold');
});

test('rejects invalid contest history division', () => {
  const rider = existingRider();
  const enrichment = {
    contestHistory: [
      {
        contest: 'Test',
        division: 'invalid',
        sourceUrl: 'https://example.com/results',
        publisher: 'ESPN',
      },
    ],
  };

  assert.throws(() => computeFieldChanges(rider, enrichment, {}, NOW), /Invalid.*division/);
});

test('rejects invalid competitive status when field is empty or overridden', () => {
  const rider = existingRider({ competitiveStatus: '' });
  const enrichment = { competitiveStatus: 'legend' };

  assert.throws(() => computeFieldChanges(rider, enrichment, {}, NOW), /Invalid competitiveStatus/);

  const rider2 = existingRider();
  assert.throws(
    () => computeFieldChanges(rider2, enrichment, { competitiveStatus: true }, NOW),
    /Invalid competitiveStatus/,
  );
});

function fakeDb({ riders = [] } = {}) {
  return {
    collection(name) {
      if (name !== 'riders') return {};
      return {
        find() {
          return {
            async toArray() {
              return riders;
            },
          };
        },
        async updateOne() {
          return { modifiedCount: 1 };
        },
      };
    },
  };
}

test('dry run finds riders and computes changes without writing', async () => {
  const rider = existingRider({ competitiveStatus: '' });
  const result = await enrichEditorialRiderBatch({
    db: fakeDb({ riders: [rider] }),
    payload: {
      batchId: 'test-batch',
      riders: [
        {
          slug: 'tony-hawk-skateboarding',
          homeRegion: 'San Diego, CA',
          competitiveStatus: 'pro',
          sponsors: ['Element'],
        },
      ],
    },
    databaseName: 'TrickList2Staging',
    now: NOW,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.enrichable, 1);
  assert.equal(result.enriched, 0);
  assert.equal(result.details[0].status, 'enrichable');
  assert.ok(result.details[0].changes.homeRegion);
  assert.ok(result.details[0].changes.competitiveStatus);
  assert.ok(result.details[0].changes.sponsors);
});

test('reports not found for missing slugs', async () => {
  const result = await enrichEditorialRiderBatch({
    db: fakeDb({ riders: [] }),
    payload: {
      batchId: 'test-batch',
      riders: [{ slug: 'nonexistent-rider' }],
    },
    databaseName: 'TrickList2Staging',
    now: NOW,
  });

  assert.equal(result.notFound, 1);
  assert.equal(result.details[0].status, 'not_found');
});

test('skips unpublished riders', async () => {
  const rider = existingRider({ reviewStatus: 'draft' });
  const result = await enrichEditorialRiderBatch({
    db: fakeDb({ riders: [rider] }),
    payload: {
      batchId: 'test-batch',
      riders: [{ slug: 'tony-hawk-skateboarding', homeRegion: 'Test' }],
    },
    databaseName: 'TrickList2Staging',
    now: NOW,
  });

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0].status, 'skipped');
});

test('apply requires matching dry-run evidence', async () => {
  const payload = {
    batchId: 'test-batch',
    riders: [{ slug: 'tony-hawk-skateboarding', homeRegion: 'Test' }],
  };

  await assert.rejects(
    enrichEditorialRiderBatch({
      db: fakeDb({ riders: [existingRider()] }),
      payload,
      databaseName: 'TrickList2Staging',
      apply: true,
      now: NOW,
    }),
    /dry-run evidence/,
  );

  await assert.rejects(
    enrichEditorialRiderBatch({
      db: fakeDb({ riders: [existingRider()] }),
      payload,
      databaseName: 'TrickList2Staging',
      apply: true,
      dryRunEvidence: {
        dryRun: true,
        batchId: 'test-batch',
        databaseName: 'TrickList2Staging',
        payloadHash: payloadHash({ ...payload, changed: true }),
      },
      now: NOW,
    }),
    /does not match the batch payload/,
  );
});

test('refuses database mismatch', async () => {
  await assert.rejects(
    enrichEditorialRiderBatch({
      db: { ...fakeDb(), databaseName: 'TrickList2' },
      payload: { batchId: 'test', riders: [{ slug: 'test' }] },
      databaseName: 'TrickList2Staging',
      now: NOW,
    }),
    /does not match the guarded target/,
  );
});

test('slug is the lookup key and does not appear in skipped warnings', () => {
  const rider = existingRider();
  const enrichment = {
    slug: 'tony-hawk-skateboarding',
    homeRegion: 'San Diego, CA',
  };

  const { skipped } = computeFieldChanges(rider, enrichment, {}, NOW);

  assert.equal(skipped.slug, undefined);
  assert.equal(skipped.biography, undefined);
});

test('contestHistory enrichment requires sourceUrl and publisher', () => {
  const rider = existingRider();

  assert.throws(
    () =>
      computeFieldChanges(
        rider,
        {
          contestHistory: [{ contest: 'X Games', year: 2020, publisher: 'ESPN' }],
        },
        {},
        NOW,
      ),
    /sourceUrl is required for enrichment/,
  );

  assert.throws(
    () =>
      computeFieldChanges(
        rider,
        {
          contestHistory: [
            { contest: 'X Games', year: 2020, sourceUrl: 'https://example.com/results' },
          ],
        },
        {},
        NOW,
      ),
    /publisher is required for enrichment/,
  );

  const { changes } = computeFieldChanges(
    rider,
    {
      contestHistory: [
        {
          contest: 'X Games',
          year: 2020,
          sourceUrl: 'https://example.com/results',
          publisher: 'ESPN',
        },
      ],
    },
    {},
    NOW,
  );
  assert.equal(changes.contestHistory.added, 1);
});
