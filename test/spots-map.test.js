const assert = require('node:assert/strict');
const test = require('node:test');
const { clusterCellSize, longitudeCondition, parseMapRequest } = require('../utils/spotsMap');

test('map request validates and normalizes viewport parameters', () => {
  const request = parseMapRequest({
    minLat: '-34',
    maxLat: '5',
    minLng: '170',
    maxLng: '-170',
    zoom: '6',
    v: '2',
  });
  assert.equal(request.version, 2);
  assert.equal(request.aggregate, true);
  assert.deepEqual(request.bounds, { minLat: -34, maxLat: 5, minLng: 170, maxLng: -170 });
});

test('map request rejects partial and invalid bounds', () => {
  assert.throws(() => parseMapRequest({ minLat: '0' }), /All bounding box/);
  assert.throws(
    () => parseMapRequest({ minLat: '10', maxLat: '-10', minLng: '-20', maxLng: '20' }),
    /minLat/,
  );
  assert.throws(
    () => parseMapRequest({ minLat: '-91', maxLat: '10', minLng: '-20', maxLng: '20' }),
    /Invalid minLat/,
  );
});

test('antimeridian longitude condition searches both sides', () => {
  assert.deepEqual(longitudeCondition(170, -170), {
    $or: [{ longitude: { $gte: 170 } }, { longitude: { $lte: -170 } }],
  });
  assert.deepEqual(longitudeCondition(-20, 20), {
    longitude: { $gte: -20, $lte: 20 },
  });
});

test('cluster cells become more precise as zoom increases', () => {
  assert.ok(clusterCellSize(3) > clusterCellSize(7));
  assert.equal(clusterCellSize(22), 0.25);
});

test('map parameters reject blank, repeated and nonnumeric input', () => {
  for (const zoom of ['', ' ', ['3', '4'], {}, 'NaN', 'Infinity', '-1', '23']) {
    assert.throws(() => parseMapRequest({ zoom }), /Invalid zoom/);
  }
  assert.equal(parseMapRequest({}).version, 1);
  assert.equal(parseMapRequest({ v: '2', zoom: '12' }).aggregate, false);
});
