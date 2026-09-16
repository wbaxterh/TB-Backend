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
