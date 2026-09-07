const assert = require('node:assert/strict');
const test = require('node:test');
const { ObjectId } = require('mongodb');
const {
  PUBLIC_RIDER_PROJECTION,
  buildEditorialRider,
  buildIdentityKey,
  ensureEditorialRiderIndexes,
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
