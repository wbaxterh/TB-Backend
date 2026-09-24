const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Stub Apple's verifier before routes/auth.js loads so no network call happens.
const appleStub = {
  payload: null,
  async verifyIdToken() {
    if (!appleStub.payload) throw new Error('invalid token');
    return appleStub.payload;
  },
};
const appleModulePath = require.resolve('apple-signin-auth');
require.cache[appleModulePath] = {
  id: appleModulePath,
  filename: appleModulePath,
  loaded: true,
  exports: appleStub,
};
const authRoute = require('../routes/auth');

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) =>
    key === '_id' ? String(doc._id) === String(value) : doc[key] === value,
  );
}

function createUsers(seed) {
  const docs = seed.map((doc) => ({ _id: new ObjectId(), ...doc }));
  const filters = [];
  return {
    docs,
    filters,
    async findOne(filter) {
      filters.push(filter);
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async insertOne(doc) {
      const _id = new ObjectId();
      docs.push({ _id, ...doc });
      return { insertedId: _id };
    },
    async updateOne(filter, update) {
      const doc = docs.find((candidate) => matches(candidate, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

async function withServer(users, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoute({ collection: () => users }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(async (body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/apple-auth`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const VICTIM = { email: 'victim@example.com', isGoogleSSO: true, role: 'admin' };

test('a body email cannot claim another account', async () => {
  const users = createUsers([VICTIM]);
  appleStub.payload = {
    sub: 'apple-attacker',
    email: 'attacker@example.com',
    email_verified: true,
  };
  await withServer(users, async (post) => {
    const { status, body } = await post({
      identityToken: 'token',
      email: 'victim@example.com',
      fullName: 'Mallory',
    });
    assert.equal(status, 200);
    const claims = jwt.verify(body.token, process.env.JWT_SECRET);
    assert.equal(claims.email, 'attacker@example.com');
    assert.equal(claims.role, null);
  });
  const victim = users.docs.find((doc) => doc.email === 'victim@example.com');
  assert.equal(victim.appleUserId, undefined);
  assert.ok(users.filters.every((filter) => !('$or' in filter)));
});

test('an unverified token email cannot link into an existing account', async () => {
  const users = createUsers([VICTIM]);
  appleStub.payload = { sub: 'apple-2', email: 'victim@example.com', email_verified: false };
  await withServer(users, async (post) => {
    const { status, body } = await post({ identityToken: 'token' });
    assert.equal(status, 409);
    assert.equal(body.code, 'AUTH_PROVIDER_MISMATCH');
  });
  assert.equal(users.docs[0].appleUserId, undefined);
  assert.equal(users.docs.length, 1);
});

test('a verified token email links Apple to an existing Google account', async () => {
  const users = createUsers([VICTIM]);
  appleStub.payload = { sub: 'apple-3', email: 'victim@example.com', email_verified: 'true' };
  await withServer(users, async (post) => {
    const { status, body } = await post({ identityToken: 'token' });
    assert.equal(status, 200);
    assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).email, 'victim@example.com');
  });
  assert.equal(users.docs[0].appleUserId, 'apple-3');
});

test('returning Apple users are found by sub even when the body lies', async () => {
  const users = createUsers([VICTIM, { email: 'rider@example.com', appleUserId: 'apple-4' }]);
  appleStub.payload = { sub: 'apple-4', email: 'rider@example.com', email_verified: true };
  await withServer(users, async (post) => {
    const { status, body } = await post({ identityToken: 'token', email: 'victim@example.com' });
    assert.equal(status, 200);
    assert.equal(jwt.verify(body.token, process.env.JWT_SECRET).email, 'rider@example.com');
  });
  assert.deepEqual(users.filters, [{ appleUserId: 'apple-4' }]);
});

test('password accounts are never auto-linked', async () => {
  const users = createUsers([{ email: 'pw@example.com', password: 'hash' }]);
  appleStub.payload = { sub: 'apple-5', email: 'pw@example.com', email_verified: true };
  await withServer(users, async (post) => {
    const { status, body } = await post({ identityToken: 'token' });
    assert.equal(status, 409);
    assert.equal(body.expectedProvider, 'password');
  });
  assert.equal(users.docs[0].appleUserId, undefined);
});

test('a token without an email cannot create an account', async () => {
  const users = createUsers([]);
  appleStub.payload = { sub: 'apple-6' };
  await withServer(users, async (post) => {
    const { status } = await post({ identityToken: 'token', email: 'anything@example.com' });
    assert.equal(status, 400);
  });
  assert.equal(users.docs.length, 0);
});

test('a first sign-in creates the account from the token email', async () => {
  const users = createUsers([]);
  appleStub.payload = { sub: 'apple-7', email: 'new@example.com', email_verified: true };
  await withServer(users, async (post) => {
    const { status } = await post({ identityToken: 'token', fullName: 'New Rider' });
    assert.equal(status, 200);
  });
  assert.equal(users.docs.length, 1);
  assert.equal(users.docs[0].email, 'new@example.com');
  assert.equal(users.docs[0].name, 'New Rider');
  assert.equal(users.docs[0].appleUserId, 'apple-7');
});

test('an invalid token is rejected', async () => {
  const users = createUsers([]);
  appleStub.payload = null;
  await withServer(users, async (post) => {
    const { status } = await post({ identityToken: 'garbage' });
    assert.equal(status, 400);
  });
});
