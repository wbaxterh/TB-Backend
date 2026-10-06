const assert = require('node:assert/strict');
const test = require('node:test');
const { ObjectId } = require('mongodb');
const { emitServerEvent, platformFromRequest } = require('../services/analyticsEmit');

const request = (userAgent) => ({ get: (name) => (name === 'user-agent' ? userAgent : undefined) });

test('guesses the client platform from the user agent', () => {
  assert.equal(platformFromRequest(request('okhttp/4.12 (Android 14)')), 'android');
  assert.equal(platformFromRequest(request('TrickBook/3.3.0 CFNetwork/1498 Darwin/23')), 'ios');
  assert.equal(platformFromRequest(request('Mozilla/5.0 (Macintosh) Chrome/130')), 'web');
  assert.equal(platformFromRequest(undefined), 'web');
});

test('writes a normalized server-origin event keyed to the user', async () => {
  const writes = [];
  const db = {
    collection: () => ({
      async updateOne(filter, update, options) {
        writes.push({ filter, update, options });
      },
    }),
  };
  const userId = new ObjectId();
  const doc = await emitServerEvent(db, {
    name: 'signup_completed',
    userId,
    properties: { method: 'google', email: 'leak@example.com' },
    req: request('okhttp/4.12 (Android 14)'),
  });
  assert.equal(doc.event, 'signup_completed');
  assert.equal(doc.userId, userId.toHexString());
  assert.equal(doc.platform, 'android');
  assert.deepEqual(doc.properties, { method: 'google' });
  assert.deepEqual(doc.source, { origin: 'server' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.upsert, true);
  assert.equal(writes[0].filter.eventId, doc.eventId);
});

test('never throws when the database rejects the write', async () => {
  const db = {
    collection: () => ({
      async updateOne() {
        throw new Error('down');
      },
    }),
  };
  const doc = await emitServerEvent(db, { name: 'signup_completed', userId: 'u1' });
  assert.equal(doc, null);
});
