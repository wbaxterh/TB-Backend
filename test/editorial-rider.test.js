const assert = require('node:assert/strict');
const test = require('node:test');
const { ObjectId } = require('mongodb');
const {
  COMPETITIVE_STATUSES,
  CONTEST_DIVISIONS,
  PUBLIC_RIDER_PROJECTION,
  buildEditorialRider,
  buildIdentityKey,
  ensureEditorialRiderIndexes,
  normalizeCompetitiveStatus,
  normalizeContestHistory,
} = require('../services/riders/editorialRider');

const NOW = new Date('2026-09-05T06:52:00.000Z');

test('builds a stable sport-scoped identity and normalized aliases', () => {
  const rider = buildEditorialRider(
    {
      canonicalName: 'Élodie Dupont',
      aliases: ['Elodie Dupont', '  E. Dupont  ', 'E. Dupont'],
      primarySport: 'Skateboarding',
    },
    NOW,
  );

  assert.equal(rider.identityKey, 'elodie-dupont:skateboarding');
  assert.equal(rider.slug, 'elodie-dupont-skateboarding');
  assert.deepEqual(rider.aliases, ['E. Dupont']);
  assert.deepEqual(rider.normalizedAliases, ['e-dupont']);
  assert.equal(buildIdentityKey('Élodie Dupont', 'skateboarding'), rider.identityKey);
  assert.equal(buildIdentityKey('Артур Левченко', 'skiing'), 'артур-левченко:skiing');
});

test('rejects unsupported sports and unsafe URL protocols', () => {
  assert.throws(
    () => buildEditorialRider({ canonicalName: 'Test Rider', primarySport: 'motocross' }, NOW),
    /Invalid primarySport/,
  );
  assert.throws(
    () =>
      buildEditorialRider(
        {
          canonicalName: 'Test Rider',
          primarySport: 'bmx',
          officialWebsite: 'javascript:alert(1)',
        },
        NOW,
      ),
    /Invalid officialWebsite URL protocol/,
  );
});

test('omits accountId entirely for unclaimed riders', () => {
  const rider = buildEditorialRider(
    { canonicalName: 'Unclaimed Rider', primarySport: 'skateboarding' },
    NOW,
  );
  // An explicit undefined is serialized as null by the driver, and the sparse
  // rider_account_unique index treats null as a value — a second unclaimed
  // rider would then collide. The key must be absent, not undefined.
  assert.equal('accountId' in rider, false);
});

test('requires an account link for claimed identities', () => {
  assert.throws(
    () =>
      buildEditorialRider(
        { canonicalName: 'Claimed Rider', primarySport: 'surfing', profileType: 'claimed' },
        NOW,
      ),
    /require accountId/,
  );

  const accountId = new ObjectId();
  const rider = buildEditorialRider(
    {
      canonicalName: 'Claimed Rider',
      primarySport: 'surfing',
      profileType: 'claimed',
      claimStatus: 'claimed',
      accountId,
    },
    NOW,
  );
  assert.equal(rider.accountId, accountId);
});

test('requires publication evidence and explicit image rights', () => {
  assert.throws(
    () =>
      buildEditorialRider(
        {
          canonicalName: 'Published Rider',
          primarySport: 'snowboarding',
          reviewStatus: 'published',
          biography: 'Original sourced biography.',
          sourceEvidence: [{ url: 'https://example.com/source-one' }],
        },
        NOW,
      ),
    /at least two evidence sources/,
  );
  assert.throws(
    () =>
      buildEditorialRider(
        {
          canonicalName: 'Duplicate Source Rider',
          primarySport: 'snowboarding',
          reviewStatus: 'published',
          biography: 'Original sourced biography.',
          sourceEvidence: [
            { url: 'https://example.com/source-one' },
            { url: 'https://example.com/source-one' },
          ],
        },
        NOW,
      ),
    /at least two evidence sources/,
  );
  assert.throws(
    () =>
      buildEditorialRider(
        {
          canonicalName: 'Image Rider',
          primarySport: 'skiing',
          heroImage: { url: 'https://example.com/rider.jpg', rightsStatus: 'unknown' },
        },
        NOW,
      ),
    /Invalid heroImage.rightsStatus/,
  );
});

test('requires explicit Couch credit evidence', () => {
  assert.throws(
    () =>
      buildEditorialRider(
        {
          canonicalName: 'Film Rider',
          primarySport: 'mtb',
          couchCredits: [{ filmId: 'film-1', creditedName: 'Film Rider' }],
        },
        NOW,
      ),
    /couchCredits\[0\].evidence URL/,
  );
});

test('public projection excludes account and editorial workflow fields', () => {
  assert.equal(PUBLIC_RIDER_PROJECTION.accountId, undefined);
  assert.equal(PUBLIC_RIDER_PROJECTION.editorial, undefined);
  assert.equal(PUBLIC_RIDER_PROJECTION.reviewStatus, undefined);
  assert.equal(PUBLIC_RIDER_PROJECTION.sourceEvidence, 1);
});

test('creates unique identity, slug, and account indexes', async () => {
  let definitions;
  const collection = {
    async createIndexes(indexes) {
      definitions = indexes;
      return indexes.map((index) => index.name);
    },
  };

  await ensureEditorialRiderIndexes(collection);
  assert.equal(definitions.find((index) => index.name === 'rider_identity_unique').unique, true);
  assert.equal(definitions.find((index) => index.name === 'rider_slug_unique').unique, true);
  assert.equal(definitions.find((index) => index.name === 'rider_account_unique').sparse, true);
});

test('validates and normalizes contest history entries', () => {
  const entries = normalizeContestHistory(
    [
      {
        contest: 'X Games',
        series: 'Summer X Games',
        edition: 'XXV',
        year: 2020,
        date: '2020-08-01',
        location: 'Minneapolis, MN',
        sport: 'skateboarding',
        discipline: 'vert',
        division: 'PRO',
        placementNumber: 1,
        placementText: '1st Place',
        medal: 'GOLD',
        sourceUrl: 'https://xgames.com/results/2020',
        publisher: 'ESPN',
      },
      {
        contest: 'Tampa Am',
        year: 2019,
        division: 'am',
        placementNumber: 5,
      },
    ],
    NOW,
  );

  assert.equal(entries.length, 2);

  const xgames = entries[0];
  assert.equal(xgames.contest, 'X Games');
  assert.equal(xgames.series, 'Summer X Games');
  assert.equal(xgames.division, 'pro');
  assert.equal(xgames.medal, 'gold');
  assert.equal(xgames.placementNumber, 1);
  assert.ok(xgames.date instanceof Date);
  assert.ok(xgames.accessedAt instanceof Date);

  const tampa = entries[1];
  assert.equal(tampa.contest, 'Tampa Am');
  assert.equal(tampa.division, 'am');
});

test('rejects contest history without contest name', () => {
  assert.throws(
    () => normalizeContestHistory([{ year: 2020, division: 'pro' }], NOW),
    /contestHistory\[0\].contest is required/,
  );
});

test('rejects invalid contest history division', () => {
  assert.throws(
    () => normalizeContestHistory([{ contest: 'Test', division: 'invalid' }], NOW),
    /Invalid contestHistory\[0\].division/,
  );
});

test('rejects invalid contest history medal', () => {
  assert.throws(
    () => normalizeContestHistory([{ contest: 'Test', medal: 'platinum' }], NOW),
    /Invalid contestHistory\[0\].medal/,
  );
});

test('rejects invalid contest history sport', () => {
  assert.throws(
    () => normalizeContestHistory([{ contest: 'Test', sport: 'motocross' }], NOW),
    /Invalid contestHistory\[0\].sport/,
  );
});

test('deduplicates contest history entries', () => {
  const entries = normalizeContestHistory(
    [
      { contest: 'X Games', year: 2020, division: 'pro', placementNumber: 1 },
      { contest: 'X Games', year: 2020, division: 'pro', placementNumber: 1 },
      { contest: 'X Games', year: 2021, division: 'pro', placementNumber: 2 },
    ],
    NOW,
  );
  assert.equal(entries.length, 2);
});

test('validates optional event ID link', () => {
  const validId = new ObjectId().toString();
  const entries = normalizeContestHistory([{ contest: 'Test', eventId: validId }], NOW);
  assert.equal(entries[0].eventId, validId);

  assert.throws(
    () => normalizeContestHistory([{ contest: 'Test', eventId: 'invalid' }], NOW),
    /contestHistory\[0\].eventId is invalid/,
  );
});

test('normalizes competitive status with valid values', () => {
  assert.equal(normalizeCompetitiveStatus('pro'), 'pro');
  assert.equal(normalizeCompetitiveStatus('PRO'), 'pro');
  assert.equal(normalizeCompetitiveStatus('am'), 'am');
  assert.equal(normalizeCompetitiveStatus('retired'), 'retired');
  assert.equal(normalizeCompetitiveStatus('unknown'), 'unknown');
  assert.equal(normalizeCompetitiveStatus(undefined), 'unknown');
  assert.equal(normalizeCompetitiveStatus(null), 'unknown');
  assert.equal(normalizeCompetitiveStatus(''), 'unknown');
});

test('rejects invalid competitive status', () => {
  assert.throws(() => normalizeCompetitiveStatus('legend'), /Invalid competitiveStatus/);
  assert.throws(() => normalizeCompetitiveStatus('amateur'), /Invalid competitiveStatus/);
});

test('includes competitiveStatus in public projection', () => {
  assert.equal(PUBLIC_RIDER_PROJECTION.competitiveStatus, 1);
});

test('buildEditorialRider includes competitiveStatus with default unknown', () => {
  const rider = buildEditorialRider(
    {
      canonicalName: 'Test Rider',
      primarySport: 'skateboarding',
    },
    NOW,
  );
  assert.equal(rider.competitiveStatus, 'unknown');

  const proRider = buildEditorialRider(
    {
      canonicalName: 'Pro Rider',
      primarySport: 'skateboarding',
      competitiveStatus: 'pro',
    },
    NOW,
  );
  assert.equal(proRider.competitiveStatus, 'pro');
});

test('buildEditorialRider validates contest history', () => {
  const rider = buildEditorialRider(
    {
      canonicalName: 'Contest Rider',
      primarySport: 'skateboarding',
      contestHistory: [
        {
          contest: 'SLS',
          year: 2023,
          division: 'pro',
          placementNumber: 3,
          medal: 'bronze',
        },
      ],
    },
    NOW,
  );
  assert.equal(rider.contestHistory.length, 1);
  assert.equal(rider.contestHistory[0].contest, 'SLS');
  assert.equal(rider.contestHistory[0].division, 'pro');
});

test('COMPETITIVE_STATUSES and CONTEST_DIVISIONS are exported', () => {
  assert.ok(COMPETITIVE_STATUSES.has('pro'));
  assert.ok(COMPETITIVE_STATUSES.has('am'));
  assert.ok(COMPETITIVE_STATUSES.has('retired'));
  assert.ok(COMPETITIVE_STATUSES.has('unknown'));

  assert.ok(CONTEST_DIVISIONS.has('pro'));
  assert.ok(CONTEST_DIVISIONS.has('am'));
  assert.ok(CONTEST_DIVISIONS.has('women'));
  assert.ok(CONTEST_DIVISIONS.has('junior'));
});
