const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { PUBLIC_SHOP_PROJECTION } = require('../routes/shops');

function createCursor(items, capture) {
  let results = [...items];
  return {
    project(value) {
      capture.projection = value;
      results = results.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([key]) => key === '_id' || value[key] === 1),
        ),
      );
      return this;
    },
    sort(value) {
      capture.sort = value;
      return this;
    },
    skip(value) {
      capture.skip = value;
      results = results.slice(value);
      return this;
    },
    limit(value) {
      capture.limit = value;
      results = results.slice(0, value);
      return this;
    },
    async toArray() {
      return results;
    },
  };
}

function createDb(items, capture = {}) {
  return {
    collection(name) {
      assert.equal(name, 'shops');
      return {
        dropIndex() {
          return Promise.resolve();
        },
        createIndex() {
          return Promise.resolve();
        },
        countDocuments(filter) {
          capture.countFilter = filter;
          return Promise.resolve(items.length);
        },
        find(filter) {
          capture.filter = filter;
          return createCursor(items, capture);
        },
        async findOne(filter, options) {
          capture.detailFilter = filter;
          capture.detailProjection = options.projection;
          return items.find((item) => item.slug === filter.$or[0].slug) || null;
        },
      };
    },
  };
}

async function withServer(db, callback) {
  const app = express();
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

test('shop list applies public filters, pagination, and safe projection', async () => {
  const capture = {};
  const db = createDb(
    [
      {
        _id: 'shop-1',
        name: 'Labor',
        slug: 'labor',
        sports: ['skateboarding'],
        status: 'published',
        internalNotes: 'private',
      },
    ],
    capture,
  );

  await withServer(db, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/shops?q=Labor&sport=skateboarding&service=gear&location=NY&limit=10`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.totalCount, 1);
    assert.equal(body.shops[0].name, 'Labor');
    assert.equal(body.shops[0].internalNotes, undefined);
  });

  assert.equal(capture.filter.$and[0].status, 'published');
  assert.deepEqual(capture.filter.$and[1], { sports: 'skateboarding' });
  assert.deepEqual(capture.filter.$and[2], { services: 'gear' });
  assert.deepEqual(capture.projection, PUBLIC_SHOP_PROJECTION);
  assert.equal(capture.limit, 10);
});

test('shop list rejects unsupported sport and service values', async () => {
  const capture = {};
  await withServer(createDb([], capture), async (baseUrl) => {
    const sportResponse = await fetch(`${baseUrl}/api/shops?sport=motocross`);
    assert.equal(sportResponse.status, 400);
    assert.deepEqual(await sportResponse.json(), { error: 'Invalid sport' });

    const serviceResponse = await fetch(`${baseUrl}/api/shops?service=tattoos`);
    assert.equal(serviceResponse.status, 400);
    assert.deepEqual(await serviceResponse.json(), { error: 'Invalid service' });
  });
  assert.equal(capture.filter, undefined);
});

test('shop detail only returns a published record through the public projection', async () => {
  const capture = {};
  await withServer(
    createDb([{ _id: 'shop-1', name: 'Labor', slug: 'labor', status: 'published' }], capture),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/shops/labor`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).shop.name, 'Labor');

      const missing = await fetch(`${baseUrl}/api/shops/missing`);
      assert.equal(missing.status, 404);
    },
  );
  assert.equal(capture.detailFilter.status, 'published');
  assert.deepEqual(capture.detailProjection, PUBLIC_SHOP_PROJECTION);
});
