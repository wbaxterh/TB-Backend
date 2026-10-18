const crypto = require('node:crypto');
const {
  normalizeCompetitiveStatus,
  normalizeContestHistory,
  normalizeCouchCredits,
  normalizeHeroImage,
  normalizeIdentityPart,
  normalizeSocialLinks,
  normalizeSourceEvidence,
  normalizeStringList,
  normalizeUrl,
  safeArray,
} = require('./editorialRider');

const STAGING_DATABASE = 'TrickList2Staging';
const PRODUCTION_DATABASE = 'TrickList2';
const MAX_ENRICHMENT_BATCH_SIZE = 15;
const MIN_ENRICHMENT_BATCH_SIZE = 1;

const ARRAY_FIELDS = new Set([
  'sponsors',
  'socialLinks',
  'contestHistory',
  'notableResults',
  'videoParts',
  'couchCredits',
  'sourceEvidence',
  'teams',
  'disciplines',
  'signatureTricks',
  'contributions',
  'aliases',
]);

const SCALAR_FIELDS = new Set([
  'nationality',
  'homeRegion',
  'officialWebsite',
  'stance',
  'ridingStyle',
  'competitiveStatus',
]);

const PROTECTED_FIELDS = new Set(['biography', 'canonicalName', 'primarySport', 'slug']);

function assertCanaryEvidence(canary) {
  if (!canary || canary.environment !== 'staging') {
    throw new Error('Production enrichments require staging canary evidence');
  }
  if (!canary.enrichedCount || canary.enrichedCount < 1) {
    throw new Error('Production enrichments require at least one successful staging enrichment');
  }
  if (!canary.apiVerified) {
    throw new Error('Production enrichments require verified staging API');
  }
  if (!/^[0-9a-f]{40}$/i.test(String(canary.stagingCommit || ''))) {
    throw new Error('Production enrichments require the verified staging commit');
  }
  const verifiedAt = new Date(canary.verifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) {
    throw new Error('Production enrichments require a valid canary verification time');
  }
}

function assertEnrichmentEnvironment({ databaseName, production = false, canary }) {
  if (production) {
    if (databaseName !== PRODUCTION_DATABASE) {
      throw new Error(`Production mode requires database ${PRODUCTION_DATABASE}`);
    }
    assertCanaryEvidence(canary);
    return 'production';
  }
  if (databaseName !== STAGING_DATABASE) {
    throw new Error(`Non-production enrichments are locked to database ${STAGING_DATABASE}`);
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

function dedupeStringArray(existing, incoming) {
  const seen = new Set(existing.map((item) => normalizeIdentityPart(item)));
  const result = [...existing];
  for (const item of incoming) {
    const normalized = normalizeIdentityPart(item);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(item);
    }
  }
  return result;
}

function dedupeSocialLinks(existing, incoming) {
  const seen = new Map(existing.map((link) => [link.platform.toLowerCase(), link]));
  for (const link of incoming) {
    const platform = link.platform.toLowerCase();
    if (!seen.has(platform)) {
      seen.set(platform, link);
    }
  }
  return [...seen.values()];
}

function dedupeContestHistory(existing, incoming) {
  const seen = new Set(
    existing.map(
      (entry) =>
        `${entry.contest}:${entry.year || ''}:${entry.division || ''}:${entry.placementNumber || entry.placementText || ''}`,
    ),
  );
  const result = [...existing];
  for (const entry of incoming) {
    const key = `${entry.contest}:${entry.year || ''}:${entry.division || ''}:${entry.placementNumber || entry.placementText || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function dedupeNotableResults(existing, incoming) {
  const seen = new Set(
    existing.map((entry) => `${entry.event || ''}:${entry.year || ''}:${entry.placement || ''}`),
  );
  const result = [...existing];
  for (const entry of incoming) {
    const key = `${entry.event || ''}:${entry.year || ''}:${entry.placement || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function dedupeVideoParts(existing, incoming) {
  const seen = new Set(existing.map((entry) => `${entry.title || ''}:${entry.year || ''}`));
  const result = [...existing];
  for (const entry of incoming) {
    const key = `${entry.title || ''}:${entry.year || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function dedupeCouchCredits(existing, incoming) {
  const seen = new Set(existing.map((entry) => `${entry.filmId}:${entry.creditedName || ''}`));
  const result = [...existing];
  for (const entry of incoming) {
    const key = `${entry.filmId}:${entry.creditedName || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function dedupeSourceEvidence(existing, incoming) {
  const seen = new Set(existing.map((entry) => entry.url));
  const result = [...existing];
  for (const entry of incoming) {
    if (!seen.has(entry.url)) {
      seen.add(entry.url);
      result.push(entry);
    }
  }
  return result;
}

function computeFieldChanges(existingRider, enrichment, overrides = {}, now = new Date()) {
  const changes = {};
  const skipped = {};

  for (const field of SCALAR_FIELDS) {
    if (enrichment[field] === undefined) continue;

    const existingValue = existingRider[field];
    const isEmpty = existingValue === undefined || existingValue === null || existingValue === '';

    if (isEmpty || overrides[field]) {
      let newValue;
      if (field === 'competitiveStatus') {
        newValue = normalizeCompetitiveStatus(enrichment[field]);
      } else if (field === 'officialWebsite') {
        newValue = normalizeUrl(enrichment[field], field);
      } else {
        newValue = String(enrichment[field]).trim();
      }

      if (newValue && newValue !== existingValue) {
        changes[field] = { from: existingValue || null, to: newValue };
      }
    } else {
      skipped[field] = 'field already populated';
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (enrichment[field] === undefined) continue;

    const existingArray = safeArray(existingRider[field]);
    let normalizedIncoming;
    let mergedArray;

    switch (field) {
      case 'socialLinks':
        normalizedIncoming = normalizeSocialLinks(enrichment[field]);
        mergedArray = dedupeSocialLinks(existingArray, normalizedIncoming);
        break;
      case 'contestHistory':
        normalizedIncoming = normalizeContestHistory(enrichment[field], now);
        mergedArray = dedupeContestHistory(existingArray, normalizedIncoming);
        break;
      case 'notableResults':
        normalizedIncoming = safeArray(enrichment[field]);
        mergedArray = dedupeNotableResults(existingArray, normalizedIncoming);
        break;
      case 'videoParts':
        normalizedIncoming = safeArray(enrichment[field]);
        mergedArray = dedupeVideoParts(existingArray, normalizedIncoming);
        break;
      case 'couchCredits':
        normalizedIncoming = normalizeCouchCredits(enrichment[field]);
        mergedArray = dedupeCouchCredits(existingArray, normalizedIncoming);
        break;
      case 'sourceEvidence':
        normalizedIncoming = normalizeSourceEvidence(enrichment[field], now);
        mergedArray = dedupeSourceEvidence(existingArray, normalizedIncoming);
        break;
      default:
        normalizedIncoming = normalizeStringList(enrichment[field]);
        mergedArray = dedupeStringArray(existingArray, normalizedIncoming);
    }

    if (mergedArray.length > existingArray.length) {
      changes[field] = {
        added: mergedArray.length - existingArray.length,
        newTotal: mergedArray.length,
        value: mergedArray,
      };
    }
  }

  if (enrichment.heroImage && !existingRider.heroImage?.url) {
    const normalized = normalizeHeroImage(enrichment.heroImage);
    if (normalized) {
      changes.heroImage = { from: null, to: normalized };
    }
  }

  if (enrichment.profileImage && !existingRider.profileImage?.url) {
    const normalized = normalizeHeroImage(enrichment.profileImage);
    if (normalized) {
      changes.profileImage = { from: null, to: normalized };
    }
  }

  if (enrichment.activeYears && !existingRider.activeYears) {
    changes.activeYears = { from: null, to: enrichment.activeYears };
  }

  for (const field of PROTECTED_FIELDS) {
    if (enrichment[field] !== undefined && !overrides[field]) {
      skipped[field] = 'protected field';
    }
  }

  return { changes, skipped };
}

function buildUpdateDocument(changes, batchId, now) {
  const $set = {
    updatedAt: now,
    'editorial.lastEnrichedAt': now,
    'editorial.lastEnrichmentBatchId': batchId,
  };

  for (const [field, change] of Object.entries(changes)) {
    if (change.value !== undefined) {
      $set[field] = change.value;
    } else if (change.to !== undefined) {
      $set[field] = change.to;
    }
  }

  return { $set };
}

function validateEnrichmentPayload(payload, now = new Date()) {
  const records = payload?.riders;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Batch must contain at least one rider enrichment');
  }
  if (records.length > MAX_ENRICHMENT_BATCH_SIZE) {
    throw new Error(`Batch exceeds the ${MAX_ENRICHMENT_BATCH_SIZE}-rider limit`);
  }
  if (records.length < MIN_ENRICHMENT_BATCH_SIZE) {
    throw new Error(`Batch must contain at least ${MIN_ENRICHMENT_BATCH_SIZE} rider`);
  }

  const batchId = String(payload.batchId || '').trim();
  if (!batchId) throw new Error('batchId is required');

  const slugs = new Set();
  const enrichments = [];

  for (const record of records) {
    const slug = String(record.slug || '').trim();
    if (!slug) throw new Error('Each enrichment record requires a slug');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`Invalid slug format: ${slug}`);
    }
    if (slugs.has(slug)) throw new Error(`Duplicate slug in batch: ${slug}`);
    slugs.add(slug);

    const overrides = record.overrides || {};
    for (const field of Object.keys(overrides)) {
      if (!SCALAR_FIELDS.has(field) && !PROTECTED_FIELDS.has(field)) {
        throw new Error(`Invalid override field: ${field}`);
      }
    }

    enrichments.push({
      slug,
      data: record,
      overrides,
    });
  }

  return { batchId, enrichments };
}

async function findExistingRiders(db, slugs) {
  const riders = await db
    .collection('riders')
    .find({ slug: { $in: slugs } })
    .toArray();
  return new Map(riders.map((rider) => [rider.slug, rider]));
}

async function enrichEditorialRiderBatch({
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

  const environment = assertEnrichmentEnvironment({ databaseName, production, canary });
  const { batchId, enrichments } = validateEnrichmentPayload(payload, now);
  const hash = payloadHash(payload);

  if (apply) {
    assertDryRunEvidence(dryRunEvidence, { batchId, databaseName, hash });
  }

  const slugs = enrichments.map((e) => e.slug);
  const existingRiders = await findExistingRiders(db, slugs);

  const results = [];
  const updateOperations = [];

  for (const { slug, data, overrides } of enrichments) {
    const existingRider = existingRiders.get(slug);

    if (!existingRider) {
      results.push({
        slug,
        status: 'not_found',
        message: 'No existing rider with this slug',
      });
      continue;
    }

    if (existingRider.reviewStatus !== 'published') {
      results.push({
        slug,
        status: 'skipped',
        message: `Rider is not published (status: ${existingRider.reviewStatus})`,
      });
      continue;
    }

    try {
      const { changes, skipped } = computeFieldChanges(existingRider, data, overrides, now);

      if (Object.keys(changes).length === 0) {
        results.push({
          slug,
          status: 'no_changes',
          skipped,
        });
        continue;
      }

      const updateDoc = buildUpdateDocument(changes, batchId, now);

      results.push({
        slug,
        status: 'enrichable',
        changes,
        skipped,
        riderId: String(existingRider._id),
      });

      updateOperations.push({
        riderId: existingRider._id,
        slug,
        updateDoc,
        changes,
      });
    } catch (error) {
      results.push({
        slug,
        status: 'error',
        message: error.message,
      });
    }
  }

  const result = {
    batchId,
    databaseName,
    environment,
    dryRun: !apply,
    payloadHash: hash,
    generatedAt: now.toISOString(),
    total: enrichments.length,
    enrichable: updateOperations.length,
    notFound: results.filter((r) => r.status === 'not_found').length,
    skipped: results.filter((r) => r.status === 'skipped' || r.status === 'no_changes').length,
    errors: results.filter((r) => r.status === 'error').length,
    enriched: 0,
    details: results,
  };

  if (!apply || updateOperations.length === 0) {
    return result;
  }

  if (!client?.startSession) {
    throw new Error('Apply mode requires a MongoDB client session');
  }

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const { riderId, updateDoc } of updateOperations) {
        await db.collection('riders').updateOne({ _id: riderId }, updateDoc, { session });
        result.enriched++;
      }
    });
  } finally {
    await session.endSession();
  }

  return result;
}

module.exports = {
  ARRAY_FIELDS,
  MAX_ENRICHMENT_BATCH_SIZE,
  MIN_ENRICHMENT_BATCH_SIZE,
  PRODUCTION_DATABASE,
  PROTECTED_FIELDS,
  SCALAR_FIELDS,
  STAGING_DATABASE,
  assertCanaryEvidence,
  assertDryRunEvidence,
  assertEnrichmentEnvironment,
  buildUpdateDocument,
  computeFieldChanges,
  dedupeContestHistory,
  dedupeCouchCredits,
  dedupeNotableResults,
  dedupeSocialLinks,
  dedupeSourceEvidence,
  dedupeStringArray,
  dedupeVideoParts,
  enrichEditorialRiderBatch,
  payloadHash,
  validateEnrichmentPayload,
};
