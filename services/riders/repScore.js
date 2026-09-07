/**
 * Rep score — a transparent 0–100 standing for editorial rider profiles,
 * computed from data the profile already carries. Components:
 *
 *   parts      film/video output (Couch credits + documented video parts)
 *   results    contest and award pedigree, weighted by placement
 *   social     linked social/web presence (a reach component based on
 *              follower counts can slot in once that ingestion exists)
 *   longevity  years active
 *   evidence   breadth of independent sourcing on the profile
 *
 * Computed at read time so edits to a profile immediately move the score.
 */

const CAPS = { parts: 40, results: 35, social: 10, longevity: 10, evidence: 5 };

function placementPoints(placement) {
  const value = String(placement || '').toLowerCase();
  if (/(1st|winner|champion|gold|soty)/.test(value)) return 12;
  if (/(2nd|3rd|silver|bronze|runner)/.test(value)) return 8;
  return 4;
}

function computeRepScore(rider, now = new Date()) {
  const partsCount = (rider.couchCredits?.length || 0) + (rider.videoParts?.length || 0);
  const parts = Math.min(CAPS.parts, partsCount * 15);

  const results = Math.min(
    CAPS.results,
    (rider.notableResults || []).reduce(
      (sum, result) => sum + placementPoints(result.placement),
      0,
    ),
  );

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

module.exports = { CAPS, computeRepScore, placementPoints };
