const { ObjectId } = require('mongodb');

const SUPPORTED_SPORTS = new Set([
  'skateboarding',
  'bmx',
  'snowboarding',
  'skiing',
  'mtb',
  'surfing',
  'wakeboarding',
  'rollerblading',
  'scooter',
]);
const PROFILE_TYPES = new Set(['member', 'editorial', 'claimed']);
const CLAIM_STATUSES = new Set(['unclaimed', 'pending', 'claimed']);
const REVIEW_STATUSES = new Set(['draft', 'reviewed', 'published', 'rejected']);
const HERO_IMAGE_RIGHTS = new Set(['controlled', 'licensed', 'reuse_permitted']);

const PUBLIC_RIDER_PROJECTION = Object.freeze({
  canonicalName: 1,
  aliases: 1,
  slug: 1,
  primarySport: 1,
  disciplines: 1,
  nationality: 1,
  homeRegion: 1,
  biography: 1,
  officialWebsite: 1,
  socialLinks: 1,
  sponsors: 1,
  teams: 1,
  stance: 1,
  ridingStyle: 1,
  notableResults: 1,
  contestHistory: 1,
  signatureTricks: 1,
  contributions: 1,
  videoParts: 1,
  activeYears: 1,
  heroImage: 1,
  couchCredits: 1,
  sourceEvidence: 1,
  profileType: 1,
  claimStatus: 1,
  createdAt: 1,
  updatedAt: 1,
});

function normalizeIdentityPart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function buildIdentityKey(canonicalName, primarySport) {
  const normalizedName = normalizeIdentityPart(canonicalName);
  const normalizedSport = normalizeIdentityPart(primarySport);
  if (!normalizedName || !normalizedSport)
    throw new Error('canonicalName and primarySport are required');
  return `${normalizedName}:${normalizedSport}`;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`Invalid ${field}: ${value}`);
  return value;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeUrl(value, field) {
  if (!value) return undefined;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`Invalid ${field} URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error(`Invalid ${field} URL protocol`);
  return parsed.toString();
}

function requireUrl(value, field) {
  const normalized = normalizeUrl(value, field);
  if (!normalized) throw new Error(`${field} URL is required`);
  return normalized;
}

function optionalDate(value, fallback) {
  return value ? new Date(value) : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSocialLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((link, index) => ({
    platform: String(link.platform || '')
      .trim()
      .toLowerCase(),
    url: normalizeUrl(link.url, `socialLinks[${index}]`),
  }));
}

function normalizeSourceEvidence(value, now) {
  if (!Array.isArray(value)) return [];
  const sources = value.map((source, index) => ({
    url: requireUrl(source.url, `sourceEvidence[${index}]`),
    title: String(source.title || '').trim(),
    publisher: String(source.publisher || '').trim(),
    claimTags: normalizeStringList(source.claimTags),
    accessedAt: source.accessedAt ? new Date(source.accessedAt) : now,
  }));
  return [...new Map(sources.map((source) => [source.url, source])).values()];
}

function normalizeHeroImage(value) {
  if (!value) return undefined;
  const rightsStatus = requireEnum(value.rightsStatus, HERO_IMAGE_RIGHTS, 'heroImage.rightsStatus');
  return {
    url: normalizeUrl(value.url, 'heroImage'),
    alt: String(value.alt || '').trim(),
    rightsStatus,
    rightsEvidenceUrl: normalizeUrl(value.rightsEvidenceUrl, 'heroImage.rightsEvidence'),
    credit: String(value.credit || '').trim(),
  };
}

function normalizeCouchCredits(value) {
  if (!Array.isArray(value)) return [];
  return value.map((credit, index) => {
    if (!credit.filmId) throw new Error(`couchCredits[${index}].filmId is required`);
    return {
      filmId: credit.filmId,
      creditedName: String(credit.creditedName || '').trim(),
      role: String(credit.role || '').trim(),
      context: String(credit.context || '').trim(),
      evidenceUrl: requireUrl(credit.evidenceUrl, `couchCredits[${index}].evidence`),
      confidence: credit.confidence || 'high',
    };
  });
}

function normalizeAccountId(value) {
  if (!value) return undefined;
  if (value instanceof ObjectId) return value;
  if (!ObjectId.isValid(value)) throw new Error('Invalid accountId');
  return new ObjectId(value);
}

function normalizeIdentity(input) {
  const canonicalName = String(input.canonicalName || '').trim();
  const primarySport = String(input.primarySport || '')
    .trim()
    .toLowerCase();
  if (!canonicalName) throw new Error('canonicalName is required');
  requireEnum(primarySport, SUPPORTED_SPORTS, 'primarySport');
  const normalizedName = normalizeIdentityPart(canonicalName);
  const aliases = normalizeStringList(input.aliases).filter(
    (alias) => normalizeIdentityPart(alias) !== normalizedName,
  );
  return { canonicalName, primarySport, normalizedName, aliases };
}

function normalizeClaim(input) {
  const profileType = requireEnum(input.profileType || 'editorial', PROFILE_TYPES, 'profileType');
  const claimStatus = requireEnum(input.claimStatus || 'unclaimed', CLAIM_STATUSES, 'claimStatus');
  const accountId = normalizeAccountId(input.accountId);
  if ((profileType === 'claimed' || claimStatus === 'claimed') && !accountId) {
    throw new Error('Claimed riders require accountId');
  }
  return { profileType, claimStatus, accountId };
}

function normalizePublication(input, now) {
  const reviewStatus = requireEnum(input.reviewStatus || 'draft', REVIEW_STATUSES, 'reviewStatus');
  const sourceEvidence = normalizeSourceEvidence(input.sourceEvidence, now);
  const biography = String(input.biography || '').trim();
  if (reviewStatus === 'published' && sourceEvidence.length < 2) {
    throw new Error('Published riders require at least two evidence sources');
  }
  if (reviewStatus === 'published' && !biography)
    throw new Error('Published riders require biography');
  return { reviewStatus, sourceEvidence, biography };
}

function normalizeEditorialMetadata(value, now) {
  const editorial = value || {};
  return {
    batchId: String(editorial.batchId || '').trim(),
    createdBy: String(editorial.createdBy || 'guarded-importer').trim(),
    reviewedBy: String(editorial.reviewedBy || '').trim(),
    reviewedAt: optionalDate(editorial.reviewedAt),
    notes: String(editorial.notes || '').trim(),
    importedAt: optionalDate(editorial.importedAt, now),
  };
}

function buildEditorialRider(input, now = new Date()) {
  const { canonicalName, primarySport, normalizedName, aliases } = normalizeIdentity(input);
  const { profileType, claimStatus, accountId } = normalizeClaim(input);
  const { reviewStatus, sourceEvidence, biography } = normalizePublication(input, now);
  const slug = input.slug
    ? normalizeIdentityPart(input.slug)
    : `${normalizedName}-${normalizeIdentityPart(primarySport)}`;
  if (!slug) throw new Error('slug is required');

  return {
    canonicalName,
    normalizedName,
    aliases,
    normalizedAliases: aliases.map(normalizeIdentityPart),
    slug,
    identityKey: buildIdentityKey(canonicalName, primarySport),
    primarySport,
    disciplines: normalizeStringList(input.disciplines),
    nationality: String(input.nationality || '').trim(),
    homeRegion: String(input.homeRegion || '').trim(),
    biography,
    officialWebsite: normalizeUrl(input.officialWebsite, 'officialWebsite'),
    socialLinks: normalizeSocialLinks(input.socialLinks),
    sponsors: normalizeStringList(input.sponsors),
    teams: normalizeStringList(input.teams),
    stance: String(input.stance || '').trim(),
    ridingStyle: String(input.ridingStyle || '').trim(),
    notableResults: safeArray(input.notableResults),
    contestHistory: safeArray(input.contestHistory),
    signatureTricks: normalizeStringList(input.signatureTricks),
    contributions: normalizeStringList(input.contributions),
    videoParts: safeArray(input.videoParts),
    activeYears: input.activeYears || undefined,
    heroImage: normalizeHeroImage(input.heroImage),
    couchCredits: normalizeCouchCredits(input.couchCredits),
    sourceEvidence,
    profileType,
    claimStatus,
    accountId,
    reviewStatus,
    editorial: normalizeEditorialMetadata(input.editorial, now),
    createdAt: optionalDate(input.createdAt, now),
    updatedAt: now,
  };
}

async function ensureEditorialRiderIndexes(collection) {
  return collection.createIndexes([
    { key: { identityKey: 1 }, name: 'rider_identity_unique', unique: true },
    { key: { slug: 1 }, name: 'rider_slug_unique', unique: true },
    { key: { accountId: 1 }, name: 'rider_account_unique', unique: true, sparse: true },
    { key: { primarySport: 1, reviewStatus: 1, canonicalName: 1 }, name: 'rider_public_directory' },
    { key: { normalizedAliases: 1, primarySport: 1 }, name: 'rider_alias_dedupe' },
  ]);
}

module.exports = {
  PUBLIC_RIDER_PROJECTION,
  SUPPORTED_SPORTS,
  buildEditorialRider,
  buildIdentityKey,
  ensureEditorialRiderIndexes,
  normalizeIdentityPart,
};
