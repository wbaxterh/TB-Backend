const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const imageRoute = require('../routes/image');

function fakeUploader({ file, error } = {}) {
  return {
    single: () => (req, _res, next) => {
      if (file) req.file = file;
      next(error);
    },
  };
}

function createDb() {
  const updates = [];
  return {
    updates,
    collection: () => ({
      async updateOne(filter, update) {
        updates.push({ filter, update });
        return { matchedCount: 1 };
      },
    }),
  };
}

async function withServer(db, uploader, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/image', imageRoute(db, { uploader, s3: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(async ({ token, body }) => {
      const headers = { 'content-type': 'application/json' };
      if (token) headers['x-auth-token'] = token;
      const response = await fetch(`http://127.0.0.1:${port}/api/image`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body || {}),
      });
      return { status: response.status, text: await response.text() };
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const USER_ID = new ObjectId();
const token = jwt.sign({ userId: USER_ID.toHexString() }, process.env.JWT_SECRET, {
  expiresIn: '1h',
});
const uploaded = { location: 'https://trickbook.s3.amazonaws.com/abc.jpg' };

test('avatar upload requires a token', async () => {
  const db = createDb();
  await withServer(db, fakeUploader({ file: uploaded }), async (post) => {
    const { status } = await post({ body: { email: 'victim@example.com' } });
    assert.equal(status, 401);
  });
  assert.equal(db.updates.length, 0);
});

test('the avatar is written to the token holder, never to a body email', async () => {
  const db = createDb();
  await withServer(db, fakeUploader({ file: uploaded }), async (post) => {
    const { status, text } = await post({ token, body: { email: 'victim@example.com' } });
    assert.equal(status, 200);
    assert.equal(text, uploaded.location);
  });
  assert.equal(db.updates.length, 1);
  assert.deepEqual(db.updates[0].filter, { _id: USER_ID });
  assert.deepEqual(db.updates[0].update, { $set: { imageUri: uploaded.location } });
});

test('a request without an accepted image file is rejected', async () => {
  const db = createDb();
  await withServer(db, fakeUploader(), async (post) => {
    const { status } = await post({ token });
    assert.equal(status, 400);
  });
  assert.equal(db.updates.length, 0);
});

test('an oversized upload is reported as 413', async () => {
  const db = createDb();
  const error = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
  await withServer(db, fakeUploader({ error }), async (post) => {
    const { status } = await post({ token });
    assert.equal(status, 413);
  });
});

test('object keys drop the client filename and keep only a safe extension', () => {
  const key = imageRoute.buildObjectKey({ originalname: '../../etc/passwd; rm -rf.PNG' });
  assert.match(key, /^[0-9a-f-]{36}\.png$/);
  assert.match(imageRoute.buildObjectKey({ originalname: 'noext' }), /^[0-9a-f-]{36}$/);
});

test('only image mime types pass the filter', () => {
  const decisions = [];
  const cb = (_error, accepted) => decisions.push(accepted);
  imageRoute.imageFileFilter({}, { mimetype: 'image/png' }, cb);
  imageRoute.imageFileFilter({}, { mimetype: 'text/html' }, cb);
  imageRoute.imageFileFilter({}, { mimetype: 'application/octet-stream' }, cb);
  assert.deepEqual(decisions, [true, false, false]);
});
