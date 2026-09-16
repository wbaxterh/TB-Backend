const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeShop } = require('../services/shops/normalizeShop');

test('normalizes a valid shop and creates a GeoJSON point', () => {
  const shop = normalizeShop({
    name: 'Labor Skate Shop',
    slug: 'labor-skate-shop',
    description: 'Independent skate shop.',
    sports: ['skateboarding'],
    services: ['gear', 'repairs'],
    address: {
      city: 'New York',
      region: 'NY',
      country: 'USA',
      lat: 40.7155,
      lng: -73.9924,
    },
    website: 'https://example.com',
    imageUrl: 'https://example.com/storefront.jpg',
    imageAlt: 'Labor Skate Shop storefront on Canal Street in New York',
    imageSourceUrl: 'https://example.com/contact',
    reviewSummary: {
      source: 'Google',
      rating: 4.8,
      reviewCount: 125,
      summary: 'Customers frequently praise the knowledgeable staff and board selection.',
      sourceUrl: 'https://maps.google.com/?cid=123',
      asOf: '2026-09-16',
    },
    faqs: [
      {
        question: 'What does Labor Skate Shop sell?',
        answer: 'The shop carries skateboards, footwear, apparel, and accessories.',
      },
    ],
    pressFeatures: [
      {
        title: 'Shop profile',
        publisher: 'Example Skate Magazine',
        url: 'https://example.com/features/labor',
        publishedAt: '2025-06-01',
        summary: 'A profile of the shop and its role in the local skate scene.',
      },
    ],
    sourceUrl: 'https://example.com/contact',
    status: 'published',
  });
  assert.deepEqual(shop.address.location, {
    type: 'Point',
    coordinates: [-73.9924, 40.7155],
  });
  assert.equal(shop.verified, false);
  assert.equal(shop.reviewSummary.source, 'Google');
  assert.equal(shop.faqs.length, 1);
  assert.equal(shop.pressFeatures.length, 1);
  assert.ok(shop.updatedAt instanceof Date);
});

test('rejects unsafe or incomplete shop records', () => {
  assert.throws(
    () =>
      normalizeShop({
        name: 'Bad Shop',
        slug: 'Unsafe Slug',
        sports: ['motocross'],
        address: { city: 'Nowhere', country: 'USA' },
        website: 'javascript:alert(1)',
      }),
    (error) => error.code === 'INVALID_SHOP',
  );
});

test('normalizes a shop with teamRiders', () => {
  const shop = normalizeShop({
    name: 'Team Skate Shop',
    slug: 'team-skate-shop',
    sports: ['skateboarding'],
    address: { city: 'Los Angeles', country: 'USA' },
    sourceUrl: 'https://example.com/team',
    teamRiders: [
      {
        name: 'Jane Doe',
        role: 'team rider',
        profileUrl: 'https://example.com/riders/jane',
        sourceUrl: 'https://example.com/team',
        imageUrl: 'https://example.com/images/jane.jpg',
      },
      {
        name: 'John Smith',
        role: 'ambassador',
      },
    ],
  });
  assert.equal(shop.teamRiders.length, 2);
  assert.equal(shop.teamRiders[0].name, 'Jane Doe');
  assert.equal(shop.teamRiders[0].role, 'team rider');
  assert.equal(shop.teamRiders[0].profileUrl, 'https://example.com/riders/jane');
  assert.equal(shop.teamRiders[1].name, 'John Smith');
  assert.equal(shop.teamRiders[1].role, 'ambassador');
});

test('teamRiders defaults to empty array when omitted', () => {
  const shop = normalizeShop({
    name: 'Simple Shop',
    slug: 'simple-shop',
    sports: ['skateboarding'],
    address: { city: 'Chicago', country: 'USA' },
    sourceUrl: 'https://example.com',
  });
  assert.deepEqual(shop.teamRiders, []);
});

test('rejects teamRiders with duplicate names (case-insensitive)', () => {
  assert.throws(
    () =>
      normalizeShop({
        name: 'Dupe Rider Shop',
        slug: 'dupe-rider-shop',
        sports: ['skateboarding'],
        address: { city: 'Seattle', country: 'USA' },
        sourceUrl: 'https://example.com',
        teamRiders: [{ name: 'Alice Walker' }, { name: 'alice walker' }],
      }),
    (error) => error.code === 'INVALID_SHOP',
  );
});

test('rejects teamRiders with name too short', () => {
  assert.throws(
    () =>
      normalizeShop({
        name: 'Short Name Shop',
        slug: 'short-name-shop',
        sports: ['skateboarding'],
        address: { city: 'Denver', country: 'USA' },
        sourceUrl: 'https://example.com',
        teamRiders: [{ name: 'A' }],
      }),
    (error) => error.code === 'INVALID_SHOP',
  );
});

test('rejects teamRiders with invalid URL schemes', () => {
  assert.throws(
    () =>
      normalizeShop({
        name: 'Bad URL Shop',
        slug: 'bad-url-shop',
        sports: ['skateboarding'],
        address: { city: 'Miami', country: 'USA' },
        sourceUrl: 'https://example.com',
        teamRiders: [
          {
            name: 'Bad Rider',
            profileUrl: 'ftp://example.com/rider',
          },
        ],
      }),
    (error) => error.code === 'INVALID_SHOP',
  );
});
