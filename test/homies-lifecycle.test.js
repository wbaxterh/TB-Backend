/**
 * Homies connection-lifecycle regression tests.
 *
 * Each scenario maps to a property from the formal specification
 * (TrickBookDocs formal/homies/Homies.tla, docs: features/homies/formal-spec)
 * and exercises the REAL route handlers (routes/users.js) against an
 * isolated in-memory collection that reproduces the MongoDB semantics the
 * handlers rely on ($push allows duplicates, $pull removes all matches,
 * one updateOne is atomic, separate updateOnes are not).
 *
 * Tests marked { todo: true } are deterministic reproductions of the
 * TLC counterexamples against CURRENT behavior — they assert the intended
 * property, fail today by design, and must have `todo` removed when the
 * corrected write path (transactional/conditional updates) ships.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'homies-test-secret';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const token = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET);

function freshUser(id) {
  return {
    _id: id,
    name: `user-${id.slice(0, 2)}`,
    network: true,
    homies: [],
    homieRequests: { sent: [], received: [] },
  };
}

function matches(entry, cond) {
  if (cond !== null && typeof cond === 'object') {
    return Object.entries(cond).every(([k, v]) => entry?.[k] === v);
  }
  return entry === cond;
}

function getPath(doc, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[k], doc);
}

function setPath(doc, dotted, value) {
  const keys = dotted.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) {
    o[k] = o[k] || {};
    o = o[k];
  }
  o[keys.at(-1)] = value;
}

/**
 * Minimal users collection honoring the operators routes/users.js uses.
 * hooks.afterUpdate(n)/afterFindOne(n) let a test interleave a concurrent
 * request between a handler's separate database operations — the exact
 * freedom a real deployment has.
 */
function createUsersCollection(docs, hooks = {}) {
  const byId = new Map(docs.map((d) => [d._id, d]));
  let updates = 0;
  let finds = 0;

  function applyUpdate(doc, update) {
    for (const [path, value] of Object.entries(update.$push || {})) {
      const arr = getPath(doc, path) || [];
      arr.push(value); // $push: duplicates allowed, faithfully
      setPath(doc, path, arr);
    }
    for (const [path, value] of Object.entries(update.$addToSet || {})) {
      const arr = getPath(doc, path) || [];
      if (!arr.some((e) => matches(e, value))) arr.push(value);
      setPath(doc, path, arr);
    }
    for (const [path, cond] of Object.entries(update.$pull || {})) {
      const arr = getPath(doc, path) || [];
      setPath(
        doc,
        path,
        arr.filter((e) => !matches(e, cond)), // $pull removes ALL matches
      );
    }
  }

  function filterMatches(doc, key, value) {
    if (key === 'homieRequests.received.from') {
      return doc.homieRequests.received.some((r) => r.from === value);
    }
    return getPath(doc, key) === value;
  }

  return {
    async findOne(filter) {
      finds += 1;
      const doc = byId.get(filter._id.toString());
      if (!doc) return null;
      const extra = Object.entries(filter).filter(([k]) => k !== '_id');
      if (!extra.every(([k, v]) => filterMatches(doc, k, v))) return null;
      // Snapshot BEFORE the hook: the read is committed at its own moment;
      // the hook models concurrent operations landing after it.
      const snapshot = structuredClone(doc);
      if (hooks.afterFindOne) await hooks.afterFindOne(finds);
      return snapshot;
    },
    async updateOne(filter, update) {
      updates += 1;
      if (hooks.beforeUpdate) await hooks.beforeUpdate(updates, filter, update);
      const doc = byId.get(filter._id.toString());
      if (doc) applyUpdate(doc, update); // one updateOne = atomic, as in MongoDB
      if (hooks.afterUpdate) await hooks.afterUpdate(updates, filter, update);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
    find() {
      return { project: () => ({ toArray: async () => [] }) };
    },
    doc: (id) => byId.get(id),
  };
}

async function withServer(usersCollection, callback) {
  const app = express();
  app.use(express.json());
  const db = { collection: () => usersCollection };
  app.use('/api/users', require('../routes/users')(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await callback(async (method, path, asUser) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/users${path}`, {
        method,
        headers: { 'x-auth-token': token(asUser), 'content-type': 'application/json' },
      });
      return res;
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

const pendingFromA = () => ({
  ...freshUser(B),
  homieRequests: { sent: [], received: [{ from: A, sentAt: new Date() }] },
});

// ---------------------------------------------------------------------------
// Behaviors that are SAFE today (pinning tests — must keep passing)
// ---------------------------------------------------------------------------

test('send retry after committed success is rejected, not duplicated', async () => {
  const a = { ...freshUser(A), homieRequests: { sent: [B], received: [] } };
  const users = createUsersCollection([a, pendingFromA()]);
  await withServer(users, async (call) => {
    // First send committed, response lost, client retries:
    const res = await call('POST', `/${B}/homie-request`, A);
    assert.equal(res.status, 400); // "Request already sent"
    assert.equal(users.doc(B).homieRequests.received.length, 1);
  });
});

test('acceptance without any pending request is refused (404)', async () => {
  const users = createUsersCollection([freshUser(A), freshUser(B)]);
  await withServer(users, async (call) => {
    const res = await call('POST', `/${A}/accept-homie`, B);
    assert.equal(res.status, 404);
    assert.deepEqual(users.doc(B).homies, []);
    assert.deepEqual(users.doc(A).homies, []);
  });
});

test('remove retry is idempotent', async () => {
  const a = { ...freshUser(A), homies: [B] };
  const b = { ...freshUser(B), homies: [A] };
  const users = createUsersCollection([a, b]);
  await withServer(users, async (call) => {
    assert.equal((await call('DELETE', `/homie/${B}`, A)).status, 200);
    assert.equal((await call('DELETE', `/homie/${B}`, A)).status, 200);
    assert.deepEqual(users.doc(A).homies, []);
    assert.deepEqual(users.doc(B).homies, []);
  });
});

test('self homie-request is rejected', async () => {
  const users = createUsersCollection([freshUser(A)]);
  await withServer(users, async (call) => {
    const res = await call('POST', `/${A}/homie-request`, A);
    assert.equal(res.status, 400);
    assert.deepEqual(users.doc(A).homies, []);
  });
});

// ---------------------------------------------------------------------------
// TLC counterexample reproductions (todo until the corrected writes ship).
// Each asserts the INTENDED property and fails against current behavior.
// ---------------------------------------------------------------------------

test(
  'partial-write failure must not leave a one-sided friendship (MutualHomies)',
  { todo: true },
  async () => {
    // TLC: Baseline_QuiescentMutual_Crash — accept dies between its two writes.
    let armed = true;
    const users = createUsersCollection([freshUser(A), pendingFromA()], {
      beforeUpdate: async (n) => {
        if (n === 2 && armed) {
          armed = false;
          throw new Error('simulated crash between the two accept writes');
        }
      },
    });
    await withServer(users, async (call) => {
      await call('POST', `/${A}/accept-homie`, B); // 500s; first write committed
      const bHasA = users.doc(B).homies.includes(A);
      const aHasB = users.doc(A).homies.includes(B);
      assert.equal(bHasA, aHasB, `asymmetric friendship persisted: B->${bHasA}, A->${aHasB}`);
    });
  },
);

test(
  'a removal racing an accept must win or lose atomically, never interleave (QuiescentMutualHomies)',
  { todo: true },
  async () => {
    // TLC: Baseline_QuiescentMutual_NoCrash — remove lands between accept's writes.
    let call_;
    let raced = false;
    const users = createUsersCollection([freshUser(A), pendingFromA()], {
      afterUpdate: async (n) => {
        if (n === 1 && !raced) {
          raced = true; // B's remove executes fully between accept's two writes
          await call_('DELETE', `/homie/${A}`, B);
        }
      },
    });
    await withServer(users, async (call) => {
      call_ = call;
      await call('POST', `/${A}/accept-homie`, B);
      const bHasA = users.doc(B).homies.includes(A);
      const aHasB = users.doc(A).homies.includes(B);
      assert.equal(bHasA, aHasB, `after accept+remove race: B->${bHasA}, A->${aHasB}`);
    });
  },
);

test(
  'double-accept must not create duplicate friendship entries (NoDuplicateHomies)',
  { todo: true },
  async () => {
    // TLC: Baseline_DuplicateHomies / Baseline_GhostAcceptance — both accepts
    // validate before either consumes the request, then both $push.
    let call_;
    let raced = false;
    const users = createUsersCollection([freshUser(A), pendingFromA()], {
      afterFindOne: async () => {
        if (!raced) {
          raced = true; // second tap completes fully between validate and write
          await call_('POST', `/${A}/accept-homie`, B);
        }
      },
    });
    await withServer(users, async (call) => {
      call_ = call;
      await call('POST', `/${A}/accept-homie`, B);
      const copies = users.doc(B).homies.filter((h) => h === A).length;
      assert.equal(copies, 1, `B's homies contains A ${copies} times`);
    });
  },
);

test(
  'double-send must not create duplicate request entries (NoDuplicateRequests)',
  { todo: true },
  async () => {
    // TLC: Baseline_DuplicateRequests — both sends pass the already-requested
    // check against the same snapshot, then both $push.
    let call_;
    let raced = false;
    const users = createUsersCollection([freshUser(A), freshUser(B)], {
      afterFindOne: async (n) => {
        if (n === 1 && !raced) {
          raced = true; // second tap completes fully between validate and write
          await call_('POST', `/${B}/homie-request`, A);
        }
      },
    });
    await withServer(users, async (call) => {
      call_ = call;
      await call('POST', `/${B}/homie-request`, A);
      const entries = users.doc(B).homieRequests.received.filter((r) => r.from === A).length;
      assert.equal(entries, 1, `B's received contains ${entries} requests from A`);
    });
  },
);

test(
  'a stale crossed request must not reconnect a removed friendship (NoResurrectedConnection)',
  { todo: true },
  async () => {
    // TLC: Corrected_Tx_Resurrect. Fully sequential — no race needed:
    // crossed requests, accept one, remove, then accept the leftover.
    const a = {
      ...freshUser(A),
      homieRequests: { sent: [B], received: [{ from: B, sentAt: new Date() }] },
    };
    const b = {
      ...freshUser(B),
      homieRequests: { sent: [A], received: [{ from: A, sentAt: new Date() }] },
    };
    const users = createUsersCollection([a, b]);
    await withServer(users, async (call) => {
      assert.equal((await call('POST', `/${A}/accept-homie`, B)).status, 200); // homies
      assert.equal((await call('DELETE', `/homie/${A}`, B)).status, 200); // B removes A
      // A now accepts B's OLD request from before the first friendship:
      await call('POST', `/${B}/accept-homie`, A);
      assert.equal(
        users.doc(B).homies.includes(A) || users.doc(A).homies.includes(B),
        false,
        'stale pre-removal request re-created the friendship without fresh consent',
      );
    });
  },
);

test(
  'a crashed send must not leave a request only one side can see (QuiescentRequestSymmetry)',
  { todo: true },
  async () => {
    // TLC: Baseline_RequestSymmetry — send dies after writing the target's
    // received entry, before writing the sender's sent entry.
    let armed = true;
    const users = createUsersCollection([freshUser(A), freshUser(B)], {
      beforeUpdate: async (n) => {
        if (n === 2 && armed) {
          armed = false;
          throw new Error('simulated crash between the two send writes');
        }
      },
    });
    await withServer(users, async (call) => {
      await call('POST', `/${B}/homie-request`, A); // 500s; first write committed
      const bSees = users.doc(B).homieRequests.received.some((r) => r.from === A);
      const aSees = users.doc(A).homieRequests.sent.includes(B);
      assert.equal(bSees, aSees, `request visible to B=${bSees} but to A=${aSees}`);
    });
  },
);
