const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const TEST_JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

function createToken(userId, expiresIn = '1h') {
  return jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn });
}

const TEST_USER_ID = new ObjectId().toString();
const TEST_OTHER_USER_ID = new ObjectId().toString();
const TEST_SHOP_ID = new ObjectId();

function matchesShopFilter(shop, filter) {
  if (filter.status && shop.status !== filter.status) return false;
  if (filter.$or) {
    return filter.$or.some(
      (cond) =>
        (cond.slug && cond.slug === shop.slug) ||
        (cond._id && cond._id.toString() === shop._id.toString()),
    );
  }
  if (filter.$and) {
    return filter.$and.every((condition) => {
      if (condition.status && shop.status !== condition.status) return false;
      return true;
    });
  }
  return true;
}

function matchesRatingFilter(rating, filter) {
  if (filter.shopId && rating.shopId !== filter.shopId) return false;
  if (filter.userId && rating.userId !== filter.userId) return false;
  return true;
}

function createShopsCollection(shops, captureUpdates = null) {
  return {
    createIndex() {
      return Promise.resolve();
    },
    dropIndex() {
      return Promise.resolve();
    },
    countDocuments(filter) {
      return Promise.resolve(
        shops.filter((s) =>
          filter.$and ? matchesShopFilter(s, filter) : s.status === filter.status,
        ).length,
      );
    },
    find(filter) {
      const results = shops.filter((s) => matchesShopFilter(s, filter));
      return {
        project() {
          return this;
        },
        sort() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        toArray() {
          return Promise.resolve(results);
        },
      };
    },
    findOne(filter) {
      const match = shops.find((s) => matchesShopFilter(s, filter));
      return Promise.resolve(match || null);
    },
    updateOne(filter, update) {
      const shop = shops.find((s) => s._id.toString() === filter._id.toString());
      if (shop && update.$set) {
        for (const [key, value] of Object.entries(update.$set)) {
          const parts = key.split('.');
          if (parts.length === 2) {
            if (!shop[parts[0]]) shop[parts[0]] = {};
            shop[parts[0]][parts[1]] = value;
          } else {
            shop[key] = value;
          }
        }
        if (captureUpdates) captureUpdates.push({ filter, update, shop });
      }
      return Promise.resolve({ modifiedCount: shop ? 1 : 0 });
    },
  };
}

function createShopRatingsCollection(shopRatingsStore) {
  const insertedRatingId = new ObjectId();
  return {
    createIndex() {
      return Promise.resolve();
    },
    find(filter) {
      const results = shopRatingsStore.filter((r) => matchesRatingFilter(r, filter));
      return {
        toArray() {
          return Promise.resolve(results);
        },
      };
    },
    findOne(filter) {
      return Promise.resolve(shopRatingsStore.find((r) => matchesRatingFilter(r, filter)) || null);
    },
    updateOne(filter, update, options) {
      let rating = shopRatingsStore.find((r) => matchesRatingFilter(r, filter));
      if (!rating && options?.upsert) {
        rating = { _id: insertedRatingId, ...filter };
        if (update.$setOnInsert) Object.assign(rating, update.$setOnInsert);
        shopRatingsStore.push(rating);
      }
      if (rating && update.$set) Object.assign(rating, update.$set);
      return Promise.resolve({ modifiedCount: rating ? 1 : 0, upsertedCount: rating ? 1 : 0 });
    },
    deleteOne(filter) {
      const idx = shopRatingsStore.findIndex((r) => matchesRatingFilter(r, filter));
      if (idx >= 0) {
        shopRatingsStore.splice(idx, 1);
        return Promise.resolve({ deletedCount: 1 });
      }
      return Promise.resolve({ deletedCount: 0 });
    },
  };
}

function createUsersCollection(users) {
  return {
    find(filter) {
      const ids = filter._id?.$in?.map((id) => id.toString()) || [];
      const results = users.filter((u) => ids.includes(u._id.toString()));
      return {
        project() {
          return this;
        },
        toArray() {
          return Promise.resolve(results);
        },
      };
    },
    findOne(filter) {
      const id = filter._id?.toString();
      return Promise.resolve(users.find((u) => u._id.toString() === id) || null);
    },
  };
}

function createMockDb(options = {}) {
  const { shops = [], shopRatings = [], users = [] } = options;
  const shopRatingsStore = [...shopRatings];
  const shopUpdates = [];

  return {
    collection(name) {
      if (name === 'shops') return createShopsCollection(shops, shopUpdates);
      if (name === 'shop_ratings') return createShopRatingsCollection(shopRatingsStore);
      if (name === 'users') return createUsersCollection(users);
      return {
        createIndex() {
          return Promise.resolve();
        },
        dropIndex() {
          return Promise.resolve();
        },
        find() {
          return {
            project() {
              return this;
            },
            toArray() {
              return Promise.resolve([]);
            },
          };
        },
        findOne() {
          return Promise.resolve(null);
        },
      };
    },
    _shopRatingsStore: shopRatingsStore,
    _shopUpdates: shopUpdates,
  };
}

async function withServer(db, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/shops', require('../routes/shops')(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

// =============================================
// GET /api/shops/:slugOrId/ratings tests
// =============================================

test('GET /ratings returns 404 for missing shop', async () => {
  const db = createMockDb({ shops: [] });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/nonexistent/ratings`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Shop not found');
  });
});

test('GET /ratings returns empty summary for shop with no ratings', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/ratings`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, null);
    assert.equal(body.ratingCount, 0);
    assert.deepEqual(body.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    assert.equal(body.myRating, null);
  });
});

test('GET /ratings returns summary with ratings', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_USER_ID, rating: 5 },
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_OTHER_USER_ID, rating: 3 },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/ratings`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 4.0);
    assert.equal(body.ratingCount, 2);
    assert.deepEqual(body.distribution, { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
    assert.equal(body.myRating, null);
  });
});

test('GET /ratings includes myRating when authenticated', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_USER_ID, rating: 4 },
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_OTHER_USER_ID, rating: 5 },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/ratings`, {
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 4.5);
    assert.equal(body.ratingCount, 2);
    assert.equal(body.myRating, 4);
  });
});

test('GET /ratings works with shop ID instead of slug', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/${TEST_SHOP_ID.toString()}/ratings`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ratingCount, 0);
  });
});

// =============================================
// PUT /api/shops/:slugOrId/rating tests
// =============================================

test('PUT /rating returns 401 without auth token', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    });
    assert.equal(res.status, 401);
  });
});

test('PUT /rating returns 404 for missing shop', async () => {
  const db = createMockDb({ shops: [] });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/nonexistent/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 5 }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Shop not found');
  });
});

test('PUT /rating returns 400 for invalid rating (non-integer)', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 3.5 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Rating must be an integer from 1 to 5');
  });
});

test('PUT /rating returns 400 for invalid rating (out of range)', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    for (const invalidRating of [0, 6, -1, 100]) {
      const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': createToken(TEST_USER_ID),
        },
        body: JSON.stringify({ rating: invalidRating }),
      });
      assert.equal(res.status, 400, `Expected 400 for rating ${invalidRating}`);
    }
  });
});

test('PUT /rating returns 400 for missing rating', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Rating must be an integer from 1 to 5');
  });
});

test('PUT /rating returns 400 for non-number rating', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 'five' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Rating must be an integer from 1 to 5');
  });
});

test('PUT /rating creates new rating and returns updated summary', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 5 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 5.0);
    assert.equal(body.ratingCount, 1);
    assert.equal(body.myRating, 5);
    assert.deepEqual(body.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
  });
  assert.equal(db._shopRatingsStore.length, 1);
  assert.equal(db._shopRatingsStore[0].rating, 5);
});

test('PUT /rating updates existing rating', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [{ shopId: TEST_SHOP_ID.toString(), userId: TEST_USER_ID, rating: 3 }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 5 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 5.0);
    assert.equal(body.ratingCount, 1);
    assert.equal(body.myRating, 5);
  });
  assert.equal(db._shopRatingsStore.length, 1);
  assert.equal(db._shopRatingsStore[0].rating, 5);
});

test('PUT /rating updates shop userRating denormalized fields', async () => {
  const shops = [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }];
  const db = createMockDb({
    shops,
    shopRatings: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': createToken(TEST_USER_ID),
      },
      body: JSON.stringify({ rating: 4 }),
    });
    assert.equal(res.status, 200);
  });
  assert.equal(shops[0].userRating?.averageRating, 4.0);
  assert.equal(shops[0].userRating?.ratingCount, 1);
});

// =============================================
// DELETE /api/shops/:slugOrId/rating tests
// =============================================

test('DELETE /rating returns 401 without auth token', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
  });
});

test('DELETE /rating returns 404 for missing shop', async () => {
  const db = createMockDb({ shops: [] });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/nonexistent/rating`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Shop not found');
  });
});

test('DELETE /rating removes rating and returns updated summary', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_USER_ID, rating: 5 },
      { shopId: TEST_SHOP_ID.toString(), userId: TEST_OTHER_USER_ID, rating: 3 },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 3.0);
    assert.equal(body.ratingCount, 1);
    assert.equal(body.myRating, null);
    assert.deepEqual(body.distribution, { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 });
  });
  assert.equal(db._shopRatingsStore.length, 1);
});

test('DELETE /rating is idempotent (no error when rating does not exist)', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, null);
    assert.equal(body.ratingCount, 0);
    assert.equal(body.myRating, null);
  });
});

test('DELETE /rating updates shop userRating denormalized fields', async () => {
  const shops = [
    {
      _id: TEST_SHOP_ID,
      slug: 'test-shop',
      status: 'published',
      userRating: { averageRating: 5, ratingCount: 1 },
    },
  ];
  const db = createMockDb({
    shops,
    shopRatings: [{ shopId: TEST_SHOP_ID.toString(), userId: TEST_USER_ID, rating: 5 }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/rating`, {
      method: 'DELETE',
      headers: { 'x-auth-token': createToken(TEST_USER_ID) },
    });
    assert.equal(res.status, 200);
  });
  assert.equal(shops[0].userRating?.averageRating, null);
  assert.equal(shops[0].userRating?.ratingCount, 0);
});

// =============================================
// Shop list and detail userRating tests
// =============================================

test('GET /shops list includes userRating with default when not set', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', name: 'Test Shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.shops.length, 1);
    assert.deepEqual(body.shops[0].userRating, { averageRating: null, ratingCount: 0 });
  });
});

test('GET /shops list includes userRating when set', async () => {
  const db = createMockDb({
    shops: [
      {
        _id: TEST_SHOP_ID,
        slug: 'test-shop',
        name: 'Test Shop',
        status: 'published',
        userRating: { averageRating: 4.5, ratingCount: 10 },
      },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.shops.length, 1);
    assert.deepEqual(body.shops[0].userRating, { averageRating: 4.5, ratingCount: 10 });
  });
});

test('GET /shops/:slug detail includes userRating with default when not set', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', name: 'Test Shop', status: 'published' }],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.shop.userRating, { averageRating: null, ratingCount: 0 });
  });
});

test('GET /shops/:slug detail includes userRating when set', async () => {
  const db = createMockDb({
    shops: [
      {
        _id: TEST_SHOP_ID,
        slug: 'test-shop',
        name: 'Test Shop',
        status: 'published',
        userRating: { averageRating: 3.7, ratingCount: 25 },
      },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.shop.userRating, { averageRating: 3.7, ratingCount: 25 });
  });
});

// =============================================
// Average rating precision tests
// =============================================

test('average rating is rounded to one decimal place', async () => {
  const db = createMockDb({
    shops: [{ _id: TEST_SHOP_ID, slug: 'test-shop', status: 'published' }],
    shopRatings: [
      { shopId: TEST_SHOP_ID.toString(), userId: new ObjectId().toString(), rating: 5 },
      { shopId: TEST_SHOP_ID.toString(), userId: new ObjectId().toString(), rating: 4 },
      { shopId: TEST_SHOP_ID.toString(), userId: new ObjectId().toString(), rating: 4 },
    ],
  });
  await withServer(db, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/shops/test-shop/ratings`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.averageRating, 4.3);
    assert.equal(body.ratingCount, 3);
  });
});
