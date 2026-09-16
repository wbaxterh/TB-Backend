const { normalizeIdentityPart } = require('../riders/editorialRider');

/**
 * Build a lookup map of normalized names to editorial rider slugs.
 * For each published rider, maps both the normalizedName and all normalizedAliases to the slug.
 *
 * @param {Array} publishedRiders - Array of editorial riders with reviewStatus 'published'
 * @returns {Map<string, string>} Map from normalized name to rider slug
 */
function buildRiderSlugMap(publishedRiders) {
  const map = new Map();
  for (const rider of publishedRiders) {
    if (!rider.slug) continue;
    if (rider.normalizedName) {
      map.set(rider.normalizedName, rider.slug);
    }
    if (Array.isArray(rider.normalizedAliases)) {
      for (const alias of rider.normalizedAliases) {
        if (alias && !map.has(alias)) {
          map.set(alias, rider.slug);
        }
      }
    }
  }
  return map;
}

/**
 * Match a team rider name against a rider slug map.
 * Returns the slug if an exact match (case-insensitive, normalized) is found.
 *
 * @param {string} name - The team rider name to match
 * @param {Map<string, string>} slugMap - Map from normalized name to rider slug
 * @returns {string|undefined} The matched rider slug or undefined
 */
function matchRiderSlug(name, slugMap) {
  const normalized = normalizeIdentityPart(name);
  if (!normalized) return undefined;
  return slugMap.get(normalized);
}

/**
 * Enrich an array of teamRiders with riderSlug where an exact match exists.
 * Unmatched riders are returned unchanged (without riderSlug).
 *
 * @param {Array} teamRiders - Array of team rider objects with name property
 * @param {Map<string, string>} slugMap - Map from normalized name to rider slug
 * @returns {Array} Enriched array with riderSlug added to matched riders
 */
function enrichTeamRidersWithSlugs(teamRiders, slugMap) {
  if (!Array.isArray(teamRiders) || teamRiders.length === 0) {
    return teamRiders || [];
  }
  return teamRiders.map((rider) => {
    const slug = matchRiderSlug(rider.name, slugMap);
    if (slug) {
      return { ...rider, riderSlug: slug };
    }
    return rider;
  });
}

/**
 * Fetch published editorial riders and build a slug map for efficient matching.
 *
 * @param {Collection} ridersCollection - MongoDB collection for riders
 * @returns {Promise<Map<string, string>>} Map from normalized name to rider slug
 */
async function fetchPublishedRiderSlugMap(ridersCollection) {
  const riders = await ridersCollection
    .find({ reviewStatus: 'published' })
    .project({ slug: 1, normalizedName: 1, normalizedAliases: 1 })
    .toArray();
  return buildRiderSlugMap(riders);
}

/**
 * Enrich a single shop's teamRiders array with riderSlugs.
 *
 * @param {Object} shop - Shop object with optional teamRiders array
 * @param {Map<string, string>} slugMap - Map from normalized name to rider slug
 * @returns {Object} Shop with enriched teamRiders
 */
function enrichShopTeamRiders(shop, slugMap) {
  if (!shop || !shop.teamRiders) return shop;
  return {
    ...shop,
    teamRiders: enrichTeamRidersWithSlugs(shop.teamRiders, slugMap),
  };
}

/**
 * Enrich an array of shops with riderSlugs in their teamRiders.
 *
 * @param {Array} shops - Array of shop objects
 * @param {Map<string, string>} slugMap - Map from normalized name to rider slug
 * @returns {Array} Shops with enriched teamRiders
 */
function enrichShopsTeamRiders(shops, slugMap) {
  return shops.map((shop) => enrichShopTeamRiders(shop, slugMap));
}

module.exports = {
  buildRiderSlugMap,
  matchRiderSlug,
  enrichTeamRidersWithSlugs,
  fetchPublishedRiderSlugMap,
  enrichShopTeamRiders,
  enrichShopsTeamRiders,
};
