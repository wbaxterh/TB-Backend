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
    sourceUrl: 'https://example.com/contact',
    status: 'published',
  });
  assert.deepEqual(shop.address.location, {
    type: 'Point',
    coordinates: [-73.9924, 40.7155],
  });
  assert.equal(shop.verified, false);
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
