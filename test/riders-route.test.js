const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { PUBLIC_RIDER_PROJECTION } = require('../services/riders/editorialRider');

function createCursor(items, capture) {
  let results = items;
  return {
    project(projection) {
      capture.projection = projection;
      results = results.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([key]) => key === '_id' || projection[key] === 1),
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

async function withServer(db, callback) {
  const app = express();
  app.use('/api/riders', require('../routes/riders')(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function createDb(editorialItems, capture = {}) {
  const riders = {
    find(filter) {
      capture.filter = filter;
      return createCursor(editorialItems, capture);
    },
    async countDocuments(filter) {
      capture.countFilter = filter;
      return editorialItems.length;
    },
    async findOne(filter, options) {
      capture.detailFilter = filter;
      capture.detailProjection = options.projection;
      const item = editorialItems.find(
        (candidate) => candidate.slug === filter.slug && candidate.reviewStatus === 'published',
      );
      if (!item) return null;
      return Object.fromEntries(
        Object.entries(item).filter(([key]) => key === '_id' || options.projection[key] === 1),
      );
    },
  };
  return {
    collection(name) {
      if (name === 'riders') return riders;
      return {};
    },
  };
}

test('riders route exports a router factory', () => {
  const createRidersRouter = require('../routes/riders');
  assert.equal(typeof createRidersRouter, 'function');
});

test('editorial list only queries published riders and applies the safe projection', async () => {
  const capture = {};
  const db = createDb(
    [
      {
        _id: 'rider-1',
        canonicalName: 'Test Rider',
        slug: 'test-rider-skateboarding',
        primarySport: 'skateboarding',
        biography: 'A sourced public biography.',
        reviewStatus: 'published',
        accountId: 'private-account-id',
        editorial: { notes: 'private notes' },
      },
    ],
    capture,
  );

  await withServer(db, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/riders/editorial?sport=Skateboarding&q=Test&page=1&limit=3`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.page, 1);
    assert.equal(body.limit, 3);
    assert.equal(body.items[0].canonicalName, 'Test Rider');
    assert.equal(body.items[0].accountId, undefined);
    assert.equal(body.items[0].editorial, undefined);
    assert.equal(body.items[0].reviewStatus, undefined);
  });

  assert.equal(capture.filter.reviewStatus, 'published');
  assert.equal(capture.filter.primarySport, 'skateboarding');
  assert.equal(capture.filter.$or[0].canonicalName.$regex, 'Test');
  assert.deepEqual(capture.projection, PUBLIC_RIDER_PROJECTION);
  assert.equal(capture.skip, 0);
});

test('editorial list rejects unsupported sports before querying the database', async () => {
  const capture = {};
  const db = createDb([], capture);

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/riders/editorial?sport=motocross`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid sport' });
  });

  assert.equal(capture.filter, undefined);
});

test('editorial detail requires a published slug and never projects workflow fields', async () => {
  const capture = {};
  const db = createDb(
    [
      {
        _id: 'rider-1',
        canonicalName: 'Test Rider',
        slug: 'test-rider-skateboarding',
        primarySport: 'skateboarding',
        reviewStatus: 'published',
        accountId: 'private-account-id',
        editorial: { notes: 'private notes' },
      },
    ],
    capture,
  );

  await withServer(db, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/riders/editorial/test-rider-skateboarding`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.canonicalName, 'Test Rider');
    assert.equal(body.accountId, undefined);
    assert.equal(body.editorial, undefined);
    assert.equal(body.reviewStatus, undefined);

    const invalidResponse = await fetch(`${baseUrl}/api/riders/editorial/Unsafe%20Slug`);
    assert.equal(invalidResponse.status, 400);
  });

  assert.deepEqual(capture.detailFilter, {
    slug: 'test-rider-skateboarding',
    reviewStatus: 'published',
  });
  assert.deepEqual(capture.detailProjection, PUBLIC_RIDER_PROJECTION);
});
