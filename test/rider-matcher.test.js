const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildRiderSlugMap,
  matchRiderSlug,
  enrichTeamRidersWithSlugs,
  fetchPublishedRiderSlugMap,
  enrichShopTeamRiders,
  enrichShopsTeamRiders,
} = require('../services/shops/riderMatcher');

const MOCK_RIDERS = [
  {
    slug: 'tony-hawk-skateboarding',
    normalizedName: 'tony-hawk',
    normalizedAliases: ['the-birdman', 'anthony-hawk'],
  },
  {
    slug: 'nyjah-huston-skateboarding',
    normalizedName: 'nyjah-huston',
    normalizedAliases: [],
  },
  {
    slug: 'shaun-white-snowboarding',
    normalizedName: 'shaun-white',
    normalizedAliases: ['the-flying-tomato', 'shaun-r-white'],
  },
  {
    slug: 'elodie-dupont-skateboarding',
    normalizedName: 'elodie-dupont',
    normalizedAliases: ['e-dupont'],
  },
];

test('buildRiderSlugMap creates map from normalizedName to slug', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(map.get('tony-hawk'), 'tony-hawk-skateboarding');
  assert.equal(map.get('nyjah-huston'), 'nyjah-huston-skateboarding');
  assert.equal(map.get('shaun-white'), 'shaun-white-snowboarding');
});

test('buildRiderSlugMap includes aliases in the map', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(map.get('the-birdman'), 'tony-hawk-skateboarding');
  assert.equal(map.get('anthony-hawk'), 'tony-hawk-skateboarding');
  assert.equal(map.get('the-flying-tomato'), 'shaun-white-snowboarding');
});

test('buildRiderSlugMap handles riders without aliases', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(map.get('nyjah-huston'), 'nyjah-huston-skateboarding');
});

test('buildRiderSlugMap handles empty input', () => {
  const map = buildRiderSlugMap([]);
  assert.equal(map.size, 0);
});

test('buildRiderSlugMap skips riders without slug', () => {
  const riders = [{ normalizedName: 'no-slug-rider', normalizedAliases: ['alias-1'] }];
  const map = buildRiderSlugMap(riders);
  assert.equal(map.size, 0);
});

test('matchRiderSlug finds exact match by canonicalName (case-insensitive)', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('Tony Hawk', map), 'tony-hawk-skateboarding');
  assert.equal(matchRiderSlug('TONY HAWK', map), 'tony-hawk-skateboarding');
  assert.equal(matchRiderSlug('tony hawk', map), 'tony-hawk-skateboarding');
});

test('matchRiderSlug finds match by alias (case-insensitive)', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('The Birdman', map), 'tony-hawk-skateboarding');
  assert.equal(matchRiderSlug('Anthony Hawk', map), 'tony-hawk-skateboarding');
  assert.equal(matchRiderSlug('The Flying Tomato', map), 'shaun-white-snowboarding');
});

test('matchRiderSlug returns undefined for no match', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('Unknown Rider', map), undefined);
  assert.equal(matchRiderSlug('Random Person', map), undefined);
});

test('matchRiderSlug does NOT fuzzy match - close names return undefined', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('Tony Hawk Jr', map), undefined);
  assert.equal(matchRiderSlug('Tony Hawks', map), undefined);
  assert.equal(matchRiderSlug('Tony', map), undefined);
  assert.equal(matchRiderSlug('Hawk', map), undefined);
  assert.equal(matchRiderSlug('Tony H.', map), undefined);
  assert.equal(matchRiderSlug('T. Hawk', map), undefined);
  assert.equal(matchRiderSlug('Toni Hawk', map), undefined);
});

test('matchRiderSlug handles accented characters via normalization', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('Élodie Dupont', map), 'elodie-dupont-skateboarding');
  assert.equal(matchRiderSlug('Elodie Dupont', map), 'elodie-dupont-skateboarding');
  assert.equal(matchRiderSlug('E. Dupont', map), 'elodie-dupont-skateboarding');
});

test('matchRiderSlug returns undefined for empty or null input', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(matchRiderSlug('', map), undefined);
  assert.equal(matchRiderSlug(null, map), undefined);
  assert.equal(matchRiderSlug(undefined, map), undefined);
});

test('enrichTeamRidersWithSlugs adds riderSlug to matched riders', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  const teamRiders = [
    { name: 'Tony Hawk', role: 'team rider' },
    { name: 'Unknown Rider', role: 'ambassador' },
    { name: 'Nyjah Huston', role: 'pro' },
  ];
  const enriched = enrichTeamRidersWithSlugs(teamRiders, map);

  assert.equal(enriched[0].name, 'Tony Hawk');
  assert.equal(enriched[0].riderSlug, 'tony-hawk-skateboarding');
  assert.equal(enriched[0].role, 'team rider');

  assert.equal(enriched[1].name, 'Unknown Rider');
  assert.equal(enriched[1].riderSlug, undefined);
  assert.equal(enriched[1].role, 'ambassador');

  assert.equal(enriched[2].name, 'Nyjah Huston');
  assert.equal(enriched[2].riderSlug, 'nyjah-huston-skateboarding');
});

test('enrichTeamRidersWithSlugs preserves all existing fields', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  const teamRiders = [
    {
      name: 'Tony Hawk',
      role: 'legend',
      profileUrl: 'https://example.com/tony',
      sourceUrl: 'https://source.com/tony',
      imageUrl: 'https://images.com/tony.jpg',
    },
  ];
  const enriched = enrichTeamRidersWithSlugs(teamRiders, map);

  assert.equal(enriched[0].name, 'Tony Hawk');
  assert.equal(enriched[0].role, 'legend');
  assert.equal(enriched[0].profileUrl, 'https://example.com/tony');
  assert.equal(enriched[0].sourceUrl, 'https://source.com/tony');
  assert.equal(enriched[0].imageUrl, 'https://images.com/tony.jpg');
  assert.equal(enriched[0].riderSlug, 'tony-hawk-skateboarding');
});

test('enrichTeamRidersWithSlugs handles empty array', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.deepEqual(enrichTeamRidersWithSlugs([], map), []);
});

test('enrichTeamRidersWithSlugs handles null/undefined input', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.deepEqual(enrichTeamRidersWithSlugs(null, map), []);
  assert.deepEqual(enrichTeamRidersWithSlugs(undefined, map), []);
});

test('enrichShopTeamRiders enriches a single shop', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  const shop = {
    name: 'Test Shop',
    slug: 'test-shop',
    teamRiders: [
      { name: 'Tony Hawk', role: 'pro' },
      { name: 'No Match', role: 'am' },
    ],
  };
  const enriched = enrichShopTeamRiders(shop, map);

  assert.equal(enriched.name, 'Test Shop');
  assert.equal(enriched.slug, 'test-shop');
  assert.equal(enriched.teamRiders[0].riderSlug, 'tony-hawk-skateboarding');
  assert.equal(enriched.teamRiders[1].riderSlug, undefined);
});

test('enrichShopTeamRiders handles shop without teamRiders', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  const shop = { name: 'Empty Shop', slug: 'empty-shop' };
  const enriched = enrichShopTeamRiders(shop, map);

  assert.equal(enriched.name, 'Empty Shop');
  assert.equal(enriched.teamRiders, undefined);
});

test('enrichShopTeamRiders handles null shop', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  assert.equal(enrichShopTeamRiders(null, map), null);
  assert.equal(enrichShopTeamRiders(undefined, map), undefined);
});

test('enrichShopsTeamRiders enriches an array of shops', () => {
  const map = buildRiderSlugMap(MOCK_RIDERS);
  const shops = [
    {
      name: 'Shop A',
      teamRiders: [{ name: 'Tony Hawk', role: 'pro' }],
    },
    {
      name: 'Shop B',
      teamRiders: [
        { name: 'Shaun White', role: 'ambassador' },
        { name: 'No Match', role: 'team' },
      ],
    },
  ];
  const enriched = enrichShopsTeamRiders(shops, map);

  assert.equal(enriched[0].teamRiders[0].riderSlug, 'tony-hawk-skateboarding');
  assert.equal(enriched[1].teamRiders[0].riderSlug, 'shaun-white-snowboarding');
  assert.equal(enriched[1].teamRiders[1].riderSlug, undefined);
});

test('fetchPublishedRiderSlugMap queries riders collection correctly', async () => {
  let capturedFilter = null;
  let capturedProjection = null;

  const mockCollection = {
    find(filter) {
      capturedFilter = filter;
      return {
        project(projection) {
          capturedProjection = projection;
          return {
            async toArray() {
              return MOCK_RIDERS;
            },
          };
        },
      };
    },
  };

  const map = await fetchPublishedRiderSlugMap(mockCollection);

  assert.deepEqual(capturedFilter, { reviewStatus: 'published' });
  assert.deepEqual(capturedProjection, {
    slug: 1,
    normalizedName: 1,
    normalizedAliases: 1,
  });
  assert.equal(map.get('tony-hawk'), 'tony-hawk-skateboarding');
});

test('alias collision prefers first rider slug (canonical name wins)', () => {
  const riders = [
    { slug: 'rider-a', normalizedName: 'shared-name', normalizedAliases: [] },
    { slug: 'rider-b', normalizedName: 'other-name', normalizedAliases: ['shared-name'] },
  ];
  const map = buildRiderSlugMap(riders);
  assert.equal(map.get('shared-name'), 'rider-a');
});
