const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const analyticsRoute = require('../routes/analytics');

const DAY = 24 * 60 * 60 * 1000;
const ADMIN = new ObjectId();
const RIDER = new ObjectId();
const BOT = new ObjectId();
const FLAGGED = new ObjectId();

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((clause) => matches(doc, clause));
    if (key === '_id') return String(doc._id) === String(value);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$gte' in value) return doc[key] !== undefined && doc[key] >= value.$gte;
      if ('$in' in value) return value.$in.includes(doc[key]);
      if ('$ne' in value) return doc[key] !== value.$ne;
    }
    return doc[key] === value;
  });
}

function cursor(items) {
  let results = items;
  return {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    project() {
      return this;
    },
    async toArray() {
      return results;
    },
    set(next) {
      results = next;
      return this;
    },
  };
}

function createDb({ users, events }) {
  return {
    collection(name) {
      const rows = name === 'users' ? users : name === 'analytics_events' ? events : [];
      return {
        createIndex: async () => {},
        find: (filter = {}) => cursor(rows.filter((row) => matches(row, filter))),
        findOne: async (filter) => rows.find((row) => matches(row, filter)) || null,
        countDocuments: async (filter = {}) => rows.filter((row) => matches(row, filter)).length,
        estimatedDocumentCount: async () => rows.length,
        distinct: async () => [],
        aggregate: () => cursor([]),
      };
    },
  };
}

async function withServer(db, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoute(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(async (path, token) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/analytics${path}`, {
        headers: token ? { 'x-auth-token': token } : {},
      });
      return { status: response.status, body: await response.json() };
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const now = Date.now();
const users = [
  { _id: ADMIN, role: 'admin', createdAt: new Date(now - 30 * DAY) },
  { _id: RIDER, createdAt: new Date(now - 20 * DAY) },
  { _id: BOT, isBot: true, createdAt: new Date(now - 20 * DAY) },
  { _id: FLAGGED, analyticsExcluded: true, createdAt: new Date(now - 20 * DAY) },
];
const events = [
  { userId: RIDER.toHexString(), event: 'trick_landed', timestamp: new Date(now - 15 * DAY) },
  { userId: RIDER.toHexString(), event: 'post_created', timestamp: new Date(now - 2 * DAY) },
  { userId: ADMIN.toHexString(), event: 'trick_landed', timestamp: new Date(now - 1 * DAY) },
  { userId: BOT.toHexString(), event: 'trick_landed', timestamp: new Date(now - 1 * DAY) },
  { userId: FLAGGED.toHexString(), event: 'trick_landed', timestamp: new Date(now - 1 * DAY) },
  { userId: RIDER.toHexString(), event: 'app_opened', timestamp: new Date(now - 1 * DAY) },
];
const adminToken = jwt.sign({ userId: ADMIN.toHexString() }, process.env.JWT_SECRET, {
  expiresIn: '1h',
});
const riderToken = jwt.sign({ userId: RIDER.toHexString() }, process.env.JWT_SECRET, {
  expiresIn: '1h',
});

test('wpr counts only real riders and only meaningful events', async () => {
  await withServer(createDb({ users, events }), async (get) => {
    const { status, body } = await get('/dashboard/wpr?weeks=4', adminToken);
    assert.equal(status, 200);
    assert.equal(body.weeks, 4);
    assert.equal(body.series.length, 4);
    assert.equal(body.current.progressingRiders, 1);
    assert.equal(body.current.actions, 1);
    assert.deepEqual(body.excluded, { admins: 1, bots: 1, flagged: 1 });
    assert.ok(body.meaningfulEvents.includes('trick_landed'));
  });
});

test('retention reports weekly windows and drops excluded signups from the cohort', async () => {
  await withServer(createDb({ users, events }), async (get) => {
    const { status, body } = await get('/dashboard/retention?weeks=8', adminToken);
    assert.equal(status, 200);
    assert.equal(body.signups, 1);
    assert.deepEqual(
      body.retention.map((w) => w.label),
      ['W1', 'W2', 'W3', 'W4'],
    );
    const w1 = body.retention[0];
    assert.equal(w1.fromDay, 1);
    assert.equal(w1.toDay, 7);
    assert.equal(w1.day, 7);
    assert.equal(w1.eligible, 1);
    assert.equal(w1.retained, 1);
    assert.equal(body.excluded.admins, 1);
  });
});

test('dashboards stay admin-only', async () => {
  await withServer(createDb({ users, events }), async (get) => {
    assert.equal((await get('/dashboard/wpr', riderToken)).status, 403);
    assert.equal((await get('/dashboard/wpr')).status, 401);
  });
});
