const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const createRouter = require('../routes/spots');
const { MAP_PIN_LIMIT, MAP_CLUSTER_LIMIT } = require('../utils/spotsMap');

async function withServer(callback, { fail = false } = {}) {
  const capture = {};
  const collection = {
    async createIndex() {},
    find(query, options) {
      capture.query = query;
      capture.options = options;
      return {
        limit(limit) {
          capture.limit = limit;
          return this;
        },
        async toArray() {
          if (fail) throw new Error('Fixture database failure');
          return [{ _id: 'fixture-spot', name: 'Fixture park', latitude: 33, longitude: -117 }];
        },
      };
    },
    aggregate(pipeline, options) {
      capture.pipeline = pipeline;
      capture.options = options;
      return {
        async toArray() {
          if (fail) throw new Error('Fixture database failure');
          return [];
        },
      };
    },
  };
  const app = express();
  app.use('/api/spots', createRouter({ collection: () => collection }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/spots`;
  try {
    await callback(base, capture);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('v2 pins have the web envelope, public filters and bounded projection', async () => {
  await withServer(async (base, capture) => {
    const response = await fetch(
      `${base}/map-pins?v=2&zoom=12&minLat=32&maxLat=34&minLng=-118&maxLng=-116&sportType=skateboarding&category=park&country=US`,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.type, 'pins');
    assert.equal(body.items.length, 1);
    assert.ok(body.dataVersion);
    assert.equal(capture.limit, MAP_PIN_LIMIT);
    assert.equal(capture.options.maxTimeMS, 3000);
    assert.equal(capture.options.projection.description, undefined);
    assert.equal(capture.query.approvalStatus, 'approved');
    assert.equal(capture.query.sportTypes, 'skateboarding');
    assert.equal(capture.query.country, 'US');
    assert.deepEqual(capture.query.latitude, { $gte: 32, $lte: 34, $type: 'number' });
    assert.deepEqual(capture.query.$and, [
      { $or: [{ category: 'park' }, { category: 'resort', parkType: 'terrain_park' }] },
    ]);
  });
});

test('legacy clients retain the array, detail fields and uncapped query', async () => {
  await withServer(async (base, capture) => {
    const response = await fetch(`${base}/map-pins`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(await response.json()));
    assert.equal(capture.limit, 0);
    for (const field of ['rating', 'imageURL', 'description']) {
      assert.equal(capture.options.projection[field], 1);
    }
    assert.equal(capture.pipeline, undefined);
  });
});

test('low zoom uses bounded clusters and antimeridian/public filters', async () => {
  await withServer(async (base, capture) => {
    const response = await fetch(
      `${base}/map-pins?v=2&zoom=3&minLat=-30&maxLat=30&minLng=170&maxLng=-170&sportType=surfing&category=other&country=NZ`,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).type, 'clusters');
    const match = capture.pipeline[0].$match;
    assert.equal(match.approvalStatus, 'approved');
    assert.equal(match.sportTypes, 'surfing');
    assert.equal(match.country, 'NZ');
    assert.deepEqual(match.$and[0], {
      $or: [{ longitude: { $gte: 170 } }, { longitude: { $lte: -170 } }],
    });
    assert.deepEqual(match.$and[1], { category: 'other' });
    assert.ok(capture.pipeline.some((stage) => stage.$limit === MAP_CLUSTER_LIMIT));
    assert.equal(capture.options.maxTimeMS, 3000);
  });
});

test('browse-summary resolves before the ID route and applies matching filters', async () => {
  await withServer(async (base, capture) => {
    const response = await fetch(`${base}/browse-summary?country=US&sportType=bmx&category=street`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { groups: [] });
    assert.deepEqual(capture.pipeline[0].$match, {
      approvalStatus: 'approved',
      country: 'US',
      sportTypes: 'bmx',
      $and: [{ category: 'street' }],
    });
    assert.equal(capture.options.maxTimeMS, 3000);
  });
});

test('invalid viewport is rejected before querying MongoDB', async () => {
  await withServer(async (base, capture) => {
    for (const query of ['v=2&minLat=32', 'v=2&zoom=', 'v=2&zoom=3&zoom=4']) {
      const response = await fetch(`${base}/map-pins?${query}`);
      assert.equal(response.status, 400);
    }
    assert.equal(capture.query, undefined);
    assert.equal(capture.pipeline, undefined);
  });
});

test('database failures return errors rather than successful empty results', async () => {
  await withServer(
    async (base) => {
      for (const path of ['/map-pins?v=2&zoom=12', '/map-pins?v=2&zoom=3', '/browse-summary']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Internal Server Error' });
      }
    },
    { fail: true },
  );
});
