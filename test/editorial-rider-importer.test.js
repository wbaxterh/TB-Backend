const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertImportEnvironment,
  importEditorialRiderBatch,
  payloadHash,
  validateBatchPayload,
} = require('../services/riders/editorialRiderImporter');

const NOW = new Date('2026-09-05T08:25:00.000Z');
const rider = (name = 'Test Rider') => ({
  canonicalName: name,
  primarySport: 'skateboarding',
  biography: 'An original, source-backed biography.',
  reviewStatus: 'published',
  sourceEvidence: [{ url: 'https://example.com/one' }, { url: 'https://example.org/two' }],
});

function fakeDb({ riders = [], users = [] } = {}) {
  return {
    collection(name) {
      const values = name === 'riders' ? riders : users;
      return {
        find() {
          return {
            project() {
              return this;
            },
            async toArray() {
              return values;
            },
          };
        },
      };
    },
  };
}

test('locks ordinary imports to staging and requires complete production canary evidence', () => {
  assert.equal(assertImportEnvironment({ databaseName: 'TrickList2Staging' }), 'staging');
  assert.throws(() => assertImportEnvironment({ databaseName: 'TrickList2' }), /locked/);
  assert.throws(
    () => assertImportEnvironment({ databaseName: 'TrickList2', production: true }),
    /canary evidence/,
  );
  assert.equal(
    assertImportEnvironment({
      databaseName: 'TrickList2',
      production: true,
      canary: {
        environment: 'staging',
        profileCount: 3,
        apiVerified: true,
        pageVerified: true,
        featurePassed: true,
        stagingCommit: 'a'.repeat(40),
        verifiedAt: NOW.toISOString(),
      },
    }),
    'production',
  );
});

test('enforces the three-profile maximum and rejects intra-batch aliases', () => {
  assert.throws(
    () =>
      validateBatchPayload(
        { batchId: 'too-many', riders: [rider('A'), rider('B'), rider('C'), rider('D')] },
        NOW,
      ),
    /3-rider limit/,
  );
  assert.throws(
    () =>
      validateBatchPayload(
        {
          batchId: 'aliases',
          riders: [rider('Alpha Rider'), { ...rider('Beta Rider'), aliases: ['Alpha Rider'] }],
        },
        NOW,
      ),
    /Duplicate batch name or alias/,
  );
});

test('dry run finds member and editorial duplicates without writing', async () => {
  const result = await importEditorialRiderBatch({
    db: fakeDb({
      riders: [
        {
          _id: 'rider-1',
          identityKey: 'existing-rider:skateboarding',
          slug: 'existing-rider-skateboarding',
          primarySport: 'skateboarding',
          normalizedName: 'existing-rider',
          normalizedAliases: [],
        },
      ],
      users: [
        {
          _id: 'member-1',
          name: 'Member Rider',
          sports: ['skateboarding'],
          riderProfile: {},
        },
      ],
    }),
    payload: {
      batchId: 'canary-1',
      riders: [rider('Existing Rider'), rider('Member Rider'), rider('New Rider')],
    },
    databaseName: 'TrickList2Staging',
    now: NOW,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.databaseName, 'TrickList2Staging');
  assert.equal(result.payloadHash.length, 64);
  assert.equal(result.insertable, 1);
  assert.equal(result.inserted, 0);
  assert.deepEqual(
    result.duplicates.map((item) => item.type),
    ['rider', 'member'],
  );
});

test('apply refuses missing or mismatched dry-run evidence before writing', async () => {
  const payload = { batchId: 'apply-1', riders: [rider('New Rider')] };
  await assert.rejects(
    importEditorialRiderBatch({
      db: fakeDb(),
      payload,
      databaseName: 'TrickList2Staging',
      apply: true,
      now: NOW,
    }),
    /dry-run evidence/,
  );
  await assert.rejects(
    importEditorialRiderBatch({
      db: fakeDb(),
      payload,
      databaseName: 'TrickList2Staging',
      apply: true,
      dryRunEvidence: {
        dryRun: true,
        batchId: 'apply-1',
        databaseName: 'TrickList2Staging',
        payloadHash: payloadHash({ ...payload, changed: true }),
      },
      now: NOW,
    }),
    /does not match the batch payload/,
  );
});

test('refuses a connection whose actual database differs from the guarded target', async () => {
  await assert.rejects(
    importEditorialRiderBatch({
      db: { ...fakeDb(), databaseName: 'TrickList2' },
      payload: { batchId: 'wrong-db', riders: [rider()] },
      databaseName: 'TrickList2Staging',
      now: NOW,
    }),
    /does not match the guarded target/,
  );
});
