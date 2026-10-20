/**
 * Rep score — a transparent 0–100 standing for editorial rider profiles,
 * computed from data the profile already carries. Components:
 *
 *   parts      film/video output (Couch credits + documented video parts)
 *   results    contest and award pedigree, weighted by placement
 *              (from both notableResults and contestHistory, deduplicated)
 *   social     linked social/web presence (a reach component based on
 *              follower counts can slot in once that ingestion exists)
 *   longevity  years active
 *   evidence   breadth of independent sourcing on the profile
 *
 * Computed at read time so edits to a profile immediately move the score.
 */

const CAPS = { parts: 40, results: 35, social: 10, longevity: 10, evidence: 5 };

function placementPoints(placement, placementNumber) {
  const value = String(placement || '').toLowerCase();

  if (/(1st|winner|champion|gold|soty)/.test(value)) return 12;
  if (/(2nd|3rd|silver|bronze|runner)/.test(value)) return 8;
  if (/([4-9]th|10th|top.?10|finalist)/.test(value)) return 6;

  const num = placementNumber ?? Number.parseInt(value.match(/^\d+/)?.[0], 10);
  if (Number.isFinite(num)) {
    if (num === 1) return 12;
    if (num >= 2 && num <= 3) return 8;
    if (num >= 4 && num <= 10) return 6;
    return 4;
  }

  return 4;
}

function normalizeEventKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function computeResultsScore(rider) {
  const seen = new Set();
  let total = 0;

  for (const result of rider.notableResults || []) {
    const key = `${normalizeEventKey(result.event)}:${result.year || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      total += placementPoints(result.placement);
    }
  }

  for (const entry of rider.contestHistory || []) {
    const key = `${normalizeEventKey(entry.contest)}:${entry.year || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      const placement = entry.medal || entry.placementText || '';
      total += placementPoints(placement, entry.placementNumber);
    }
  }

  return Math.min(CAPS.results, total);
}

function computeRepScore(rider, now = new Date()) {
  const partsCount = (rider.couchCredits?.length || 0) + (rider.videoParts?.length || 0);
  const parts = Math.min(CAPS.parts, partsCount * 15);

  const results = computeResultsScore(rider);

  const social = Math.min(
    CAPS.social,
    (rider.socialLinks?.length || 0) * 5 + (rider.officialWebsite ? 5 : 0),
  );

  const yearsActive = rider.activeYears?.from
    ? now.getFullYear() - Number(rider.activeYears.from)
    : 0;
  const longevity = Math.max(0, Math.min(CAPS.longevity, yearsActive));

  const evidence = Math.min(CAPS.evidence, rider.sourceEvidence?.length || 0);

  const score = Math.min(100, parts + results + social + longevity + evidence);
  return { score, breakdown: { parts, results, social, longevity, evidence } };
}

module.exports = { CAPS, computeRepScore, computeResultsScore, placementPoints };
