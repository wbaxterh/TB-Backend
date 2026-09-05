const crypto = require('node:crypto');
const escapeRegex = require('../../utils/escapeRegex');
const {
  buildEditorialRider,
  ensureEditorialRiderIndexes,
  normalizeIdentityPart,
} = require('./editorialRider');

const STAGING_DATABASE = 'TrickList2Staging';
const PRODUCTION_DATABASE = 'TrickList2';
const MAX_BATCH_SIZE = 3;

function assertCanaryEvidence(canary) {
  if (!canary || canary.environment !== 'staging') {
    throw new Error('Production imports require staging canary evidence');
  }
  if (canary.profileCount !== 3) {
    throw new Error('Production imports require a three-profile staging canary');
  }
  if (!canary.apiVerified || !canary.pageVerified || !canary.featurePassed) {
    throw new Error('Production imports require verified staging API, page, and feature gates');
  }
  if (!/^[0-9a-f]{40}$/i.test(String(canary.stagingCommit || ''))) {
    throw new Error('Production imports require the verified staging commit');
  }
  const verifiedAt = new Date(canary.verifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) {
    throw new Error('Production imports require a valid canary verification time');
  }
}

function assertImportEnvironment({ databaseName, production = false, canary }) {
  if (production) {
    if (databaseName !== PRODUCTION_DATABASE) {
      throw new Error(`Production mode requires database ${PRODUCTION_DATABASE}`);
    }
    assertCanaryEvidence(canary);
    return 'production';
  }
  if (databaseName !== STAGING_DATABASE) {
    throw new Error(`Non-production imports are locked to database ${STAGING_DATABASE}`);
  }
  return 'staging';
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function assertDryRunEvidence(evidence, { batchId, databaseName, hash }) {
  if (!evidence?.dryRun) throw new Error('Apply mode requires dry-run evidence');
  if (evidence.batchId !== batchId || evidence.databaseName !== databaseName) {
    throw new Error('Dry-run evidence does not match the target batch and database');
  }
  if (evidence.payloadHash !== hash) {
    throw new Error('Dry-run evidence does not match the batch payload');
  }
}

function validateBatchPayload(payload, now = new Date()) {
  const records = payload?.riders;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Batch must contain at least one rider');
  }
  if (records.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch exceeds the ${MAX_BATCH_SIZE}-rider limit`);
  }
  const batchId = String(payload.batchId || '').trim();
  if (!batchId) throw new Error('batchId is required');

  const riders = records.map((record) =>
    buildEditorialRider(
      {
        ...record,
        profileType: record.profileType || 'editorial',
        claimStatus: record.claimStatus || 'unclaimed',
        editorial: { ...record.editorial, batchId },
      },
      now,
    ),
  );
  const identityKeys = new Set();
  const slugs = new Set();
  const sportNames = new Set();
  for (const rider of riders) {
    if (identityKeys.has(rider.identityKey))
      throw new Error(`Duplicate batch identity: ${rider.identityKey}`);
    if (slugs.has(rider.slug)) throw new Error(`Duplicate batch slug: ${rider.slug}`);
    identityKeys.add(rider.identityKey);
    slugs.add(rider.slug);
    for (const name of [rider.normalizedName, ...rider.normalizedAliases]) {
      const key = `${rider.primarySport}:${name}`;
      if (sportNames.has(key)) throw new Error(`Duplicate batch name or alias: ${key}`);
      sportNames.add(key);
    }
  }
  return { batchId, riders };
}

function namesForRider(rider) {
  return new Set([rider.normalizedName, ...rider.normalizedAliases]);
}

function memberMatchesRider(member, rider) {
  if (rider.accountId && String(member._id) === String(rider.accountId)) return true;
  const sports = Array.isArray(member.sports) ? member.sports.map(normalizeIdentityPart) : [];
  if (!sports.includes(normalizeIdentityPart(rider.primarySport))) return false;
  const names = [member.name, member.riderProfile?.nickname]
    .filter(Boolean)
    .map(normalizeIdentityPart);
  return names.some((name) => namesForRider(rider).has(name));
}

function editorialMatchesRider(existing, rider) {
  if (
    existing.accountId &&
    rider.accountId &&
    String(existing.accountId) === String(rider.accountId)
  )
    return true;
  if (existing.identityKey === rider.identityKey || existing.slug === rider.slug) return true;
  if (existing.primarySport !== rider.primarySport) return false;
  const existingNames = new Set([
    existing.normalizedName,
    ...(Array.isArray(existing.normalizedAliases) ? existing.normalizedAliases : []),
  ]);
  return [...namesForRider(rider)].some((name) => existingNames.has(name));
}

async function findDuplicates(db, riders) {
  const normalizedNames = [...new Set(riders.flatMap((rider) => [...namesForRider(rider)]))];
  const originalNames = [
    ...new Set(riders.flatMap((rider) => [rider.canonicalName, ...rider.aliases])),
  ];
  const accountIds = riders.map((rider) => rider.accountId).filter(Boolean);
  const riderFilters = [
    { identityKey: { $in: riders.map((rider) => rider.identityKey) } },
    { slug: { $in: riders.map((rider) => rider.slug) } },
    { normalizedName: { $in: normalizedNames } },
    { normalizedAliases: { $in: normalizedNames } },
  ];
  if (accountIds.length) riderFilters.push({ accountId: { $in: accountIds } });

  const [existingRiders, members] = await Promise.all([
    db.collection('riders').find({ $or: riderFilters }).toArray(),
    db
      .collection('users')
      .find({
        $or: [
          ...originalNames.flatMap((name) => {
            const exactName = { $regex: `^${escapeRegex(name)}$`, $options: 'i' };
            return [{ name: exactName }, { 'riderProfile.nickname': exactName }];
          }),
          ...(accountIds.length ? [{ _id: { $in: accountIds } }] : []),
        ],
      })
      .project({ name: 1, sports: 1, riderProfile: 1 })
      .toArray(),
  ]);

  return riders.map((rider) => {
    const editorial = existingRiders.find((existing) => editorialMatchesRider(existing, rider));
    if (editorial) return { rider, duplicateType: 'rider', duplicateId: editorial._id };
    const member = members.find((existing) => memberMatchesRider(existing, rider));
    if (member) return { rider, duplicateType: 'member', duplicateId: member._id };
    return { rider };
  });
}

async function importEditorialRiderBatch({
  db,
  client,
  payload,
  databaseName,
  apply = false,
  production = false,
  canary,
  dryRunEvidence,
  now = new Date(),
}) {
  if (db.databaseName && db.databaseName !== databaseName) {
    throw new Error('Connected MongoDB database does not match the guarded target');
  }
  const environment = assertImportEnvironment({ databaseName, production, canary });
  const { batchId, riders } = validateBatchPayload(payload, now);
  const hash = payloadHash(payload);
  if (apply) assertDryRunEvidence(dryRunEvidence, { batchId, databaseName, hash });
  const reviewed = await findDuplicates(db, riders);
  const insertable = reviewed.filter((item) => !item.duplicateType).map((item) => item.rider);
  const result = {
    batchId,
    databaseName,
    environment,
    dryRun: !apply,
    payloadHash: hash,
    generatedAt: now.toISOString(),
    total: riders.length,
    insertable: insertable.length,
    duplicates: reviewed
      .filter((item) => item.duplicateType)
      .map((item) => ({
        canonicalName: item.rider.canonicalName,
        type: item.duplicateType,
        id: String(item.duplicateId),
      })),
    inserted: 0,
  };
  if (!apply || insertable.length === 0) return result;
  if (!client?.startSession) throw new Error('Apply mode requires a MongoDB client session');

  await ensureEditorialRiderIndexes(db.collection('riders'));
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const writeResult = await db
        .collection('riders')
        .insertMany(insertable, { ordered: true, session });
      result.inserted = writeResult.insertedCount;
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = {
  MAX_BATCH_SIZE,
  PRODUCTION_DATABASE,
  STAGING_DATABASE,
  assertCanaryEvidence,
  assertDryRunEvidence,
  assertImportEnvironment,
  findDuplicates,
  importEditorialRiderBatch,
  payloadHash,
  validateBatchPayload,
};
