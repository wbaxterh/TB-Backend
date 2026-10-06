const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const bodyParser = require('body-parser');
const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const Stripe = require('stripe');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
const paymentsRoute = require('../routes/payments');

// Real signature code from the SDK; everything that would hit Stripe's API is stubbed.
const sdk = new Stripe('sk_test_dummy');
const PERIOD_END = 1_790_000_000;
const SUBSCRIPTION = {
  id: 'sub_123',
  status: 'active',
  customer: 'cus_123',
  cancel_at_period_end: false,
  current_period_end: PERIOD_END,
};

function createStripeStub(overrides = {}) {
  return {
    webhooks: sdk.webhooks,
    subscriptions: {
      retrieve: async () => SUBSCRIPTION,
      list: async () => ({ data: [SUBSCRIPTION] }),
      update: async () => ({}),
    },
    checkout: { sessions: { retrieve: async () => null } },
    customers: { create: async () => ({ id: 'cus_123' }) },
    ...overrides,
  };
}

function createDb(users) {
  const events = [];
  const updates = [];
  const db = {
    updates,
    events,
    collection(name) {
      if (name === 'users') {
        return {
          async findOne(filter) {
            if (filter._id) return users.find((u) => String(u._id) === String(filter._id)) || null;
            const [[key, value]] = Object.entries(filter);
            return users.find((u) => key.split('.').reduce((o, k) => o?.[k], u) === value) || null;
          },
          async updateOne(filter, update) {
            updates.push({ filter, update });
            const user = users.find((u) => String(u._id) === String(filter._id));
            if (user && update.$set) {
              for (const [dotted, value] of Object.entries(update.$set)) {
                const keys = dotted.split('.');
                let target = user;
                for (const key of keys.slice(0, -1)) target = target[key] ??= {};
                target[keys.at(-1)] = value;
              }
            }
            return { matchedCount: user ? 1 : 0 };
          },
        };
      }
      if (name === 'stripe_events') {
        return {
          async createIndex() {},
          async insertOne(doc) {
            if (events.some((e) => e.eventId === doc.eventId)) {
              throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            }
            events.push(doc);
          },
          async deleteOne(filter) {
            const index = events.findIndex((e) => e.eventId === filter.eventId);
            if (index >= 0) events.splice(index, 1);
          },
        };
      }
      return {};
    },
  };
  return db;
}

// Mirrors the production order in index.js: raw webhook parser, then the JSON parsers.
function createApp(db, stripe, { rawFirst = true } = {}) {
  const app = express();
  if (rawFirst) app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(bodyParser.json());
  app.use('/api/payments', paymentsRoute(db, { stripe }));
  return app;
}

async function withServer(app, callback) {
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

function signedEvent(userId, { id = 'evt_1' } = {}) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_test_abc',
        mode: 'subscription',
        subscription: 'sub_123',
        payment_status: 'paid',
        status: 'complete',
        metadata: { userId },
      },
    },
  });
  const header = sdk.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return { payload, header };
}

async function postWebhook(base, payload, header) {
  const response = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  return { status: response.status, body: await response.text() };
}

const USER_ID = new ObjectId();
const freshUser = () => ({
  _id: USER_ID,
  email: 'rider@example.com',
  subscription: { plan: 'free', status: 'active', stripeCustomerId: 'cus_123' },
});
const token = jwt.sign({ userId: USER_ID.toHexString() }, process.env.JWT_SECRET, {
  expiresIn: '1h',
});

test('index.js mounts the raw webhook parser before the JSON parser', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const raw = source.indexOf("app.use('/api/payments/webhook', express.raw(");
  const json = source.indexOf('app.use(express.json(');
  assert.ok(raw > -1, 'raw webhook mount missing');
  assert.ok(raw < json, 'raw webhook mount must come before express.json');
});

test('a signed checkout.session.completed activates premium with a real period end', async () => {
  const users = [freshUser()];
  const db = createDb(users);
  const { payload, header } = signedEvent(USER_ID.toHexString());
  await withServer(createApp(db, createStripeStub()), async (base) => {
    const { status, body } = await postWebhook(base, payload, header);
    assert.equal(status, 200, body);
  });
  const { subscription } = users[0];
  assert.equal(subscription.plan, 'premium');
  assert.equal(subscription.status, 'active');
  assert.equal(subscription.stripeSubscriptionId, 'sub_123');
  assert.ok(subscription.currentPeriodEnd instanceof Date);
  assert.equal(subscription.currentPeriodEnd.getTime(), PERIOD_END * 1000);
});

test('the same event delivered twice is applied once', async () => {
  const db = createDb([freshUser()]);
  const { payload, header } = signedEvent(USER_ID.toHexString());
  await withServer(createApp(db, createStripeStub()), async (base) => {
    assert.equal((await postWebhook(base, payload, header)).status, 200);
    const second = await postWebhook(base, payload, header);
    assert.equal(second.status, 200);
    assert.match(second.body, /"duplicate":true/);
  });
  assert.equal(db.updates.length, 1);
});

test('a tampered body is rejected and nothing is written', async () => {
  const db = createDb([freshUser()]);
  const { payload, header } = signedEvent(USER_ID.toHexString());
  const tampered = payload.replace('"paid"', '"unpaid"');
  await withServer(createApp(db, createStripeStub()), async (base) => {
    assert.equal((await postWebhook(base, tampered, header)).status, 400);
  });
  assert.equal(db.updates.length, 0);
  assert.equal(db.events.length, 0);
});

test('without the raw mount the JSON parser breaks verification (the bug this fixes)', async () => {
  const db = createDb([freshUser()]);
  const { payload, header } = signedEvent(USER_ID.toHexString());
  await withServer(createApp(db, createStripeStub(), { rawFirst: false }), async (base) => {
    const { status, body } = await postWebhook(base, payload, header);
    assert.equal(status, 400);
    assert.match(body, /Webhook Error/);
  });
  assert.equal(db.updates.length, 0);
});

test('a handler failure releases the event claim so a retry can succeed', async () => {
  const users = [freshUser()];
  const db = createDb(users);
  let calls = 0;
  const stripe = createStripeStub({
    subscriptions: {
      retrieve: async () => {
        calls += 1;
        if (calls === 1) throw new Error('stripe hiccup');
        return SUBSCRIPTION;
      },
    },
  });
  const { payload, header } = signedEvent(USER_ID.toHexString());
  await withServer(createApp(db, stripe), async (base) => {
    assert.equal((await postWebhook(base, payload, header)).status, 500);
    assert.equal(db.events.length, 0);
    assert.equal((await postWebhook(base, payload, header)).status, 200);
  });
  assert.equal(users[0].subscription.plan, 'premium');
});

test('verify-session activates the caller when the paid session is theirs', async () => {
  const users = [freshUser()];
  const db = createDb(users);
  const stripe = createStripeStub({
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_test_abc',
          payment_status: 'paid',
          status: 'complete',
          metadata: { userId: USER_ID.toHexString() },
          subscription: SUBSCRIPTION,
        }),
      },
    },
  });
  await withServer(createApp(db, stripe), async (base) => {
    const response = await fetch(`${base}/api/payments/verify-session?session_id=cs_test_abc`, {
      headers: { 'x-auth-token': token },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.verified, true);
    assert.equal(body.subscription.plan, 'premium');
  });
});

test('verify-session refuses a session that belongs to another account', async () => {
  const db = createDb([freshUser()]);
  const stripe = createStripeStub({
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_test_other',
          payment_status: 'paid',
          metadata: { userId: new ObjectId().toHexString() },
          subscription: SUBSCRIPTION,
        }),
      },
    },
  });
  await withServer(createApp(db, stripe), async (base) => {
    const response = await fetch(`${base}/api/payments/verify-session?session_id=cs_test_other`, {
      headers: { 'x-auth-token': token },
    });
    assert.equal(response.status, 403);
    const bad = await fetch(`${base}/api/payments/verify-session?session_id=../etc`, {
      headers: { 'x-auth-token': token },
    });
    assert.equal(bad.status, 400);
  });
  assert.equal(db.updates.length, 0);
});

test('reconcile upgrades an account whose customer has a live subscription', async () => {
  const users = [freshUser()];
  const db = createDb(users);
  await withServer(createApp(db, createStripeStub()), async (base) => {
    const response = await fetch(`${base}/api/payments/reconcile`, {
      method: 'POST',
      headers: { 'x-auth-token': token },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reconciled, true);
    assert.equal(body.subscription.plan, 'premium');
  });
});

test('reconcile leaves an account alone when Stripe has nothing live', async () => {
  const users = [freshUser()];
  const db = createDb(users);
  const stripe = createStripeStub({
    subscriptions: {
      list: async () => ({ data: [{ ...SUBSCRIPTION, status: 'canceled' }] }),
      retrieve: async () => SUBSCRIPTION,
    },
  });
  await withServer(createApp(db, stripe), async (base) => {
    const response = await fetch(`${base}/api/payments/reconcile`, {
      method: 'POST',
      headers: { 'x-auth-token': token },
    });
    const body = await response.json();
    assert.equal(body.reconciled, false);
    assert.equal(body.subscription.plan, 'free');
  });
  assert.equal(db.updates.length, 0);
});

test('premiumFields keeps cancel-at-period-end as canceled with access', () => {
  const fields = paymentsRoute.premiumFields({ ...SUBSCRIPTION, cancel_at_period_end: true });
  assert.equal(fields['subscription.plan'], 'premium');
  assert.equal(fields['subscription.status'], 'canceled');
  assert.equal(paymentsRoute.periodEnd({ current_period_end: 'nope' }), null);
});
