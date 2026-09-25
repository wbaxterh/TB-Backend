const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const healthRoute = require('../routes/health');

async function probe(db, options) {
  const app = express();
  app.use(['/health', '/api/health'], healthRoute(db, options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('reports ok when the database answers a ping', async () => {
  const pings = [];
  const db = {
    async command(command) {
      pings.push(command);
      return { ok: 1 };
    },
  };
  const { status, cacheControl, body } = await probe(db, { version: 'abc123' });
  assert.equal(status, 200);
  assert.equal(cacheControl, 'no-store');
  assert.deepEqual(pings, [{ ping: 1 }]);
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'ok');
  assert.equal(body.version, 'abc123');
  assert.equal(typeof body.uptimeSeconds, 'number');
  assert.ok(Date.parse(body.timestamp) > 0);
});

test('reports degraded with 503 when the database throws', async () => {
  const db = {
    async command() {
      throw new Error('connection reset');
    },
  };
  const { status, body } = await probe(db);
  assert.equal(status, 503);
  assert.equal(body.status, 'degraded');
  assert.equal(body.db, 'error');
});

test('a hanging database does not hang the probe', async () => {
  const db = { command: () => new Promise(() => {}) };
  const { status, body } = await probe(db, { pingTimeoutMs: 20 });
  assert.equal(status, 503);
  assert.equal(body.db, 'error');
});

test('the body never carries hostnames, env values or secrets', async () => {
  const db = { command: async () => ({ ok: 1 }) };
  const { body } = await probe(db);
  assert.deepEqual(Object.keys(body).sort(), [
    'db',
    'dbLatencyMs',
    'status',
    'timestamp',
    'uptimeSeconds',
    'version',
  ]);
});
