// Server half of scripts/stripe-go-live.sh — runs from /home/ubuntu/TB-Backend.
// Never prints a secret value.
//
//   node stripe-go-live-remote.js --plan    stdin: {"key":"sk_live_..."}   report what --apply would do
//   node stripe-go-live-remote.js --apply   stdin: {"key":"sk_live_...","whsec":"whsec_..."?}
//   node stripe-go-live-remote.js --verify  (no stdin) check the config currently in .env
//
// --apply: finds/creates the live TrickBook Plus price and webhook endpoint, clears
// test-mode customer ids off users (they 404 in live mode), backs up .env, then
// writes STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PREMIUM_PRICE_ID.
require('dotenv').config();
const fs = require('fs');
const { MongoClient } = require('mongodb');
const Stripe = require('stripe');

const WEBHOOK_URL = 'https://api.thetrickbook.com/api/payments/webhook';
const LOOKUP_KEY = 'trickbook_plus_monthly';
const DB_NAME = 'TrickList2';
// Must match the switch in routes/payments.js webhook handler
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

const mode = process.argv[2];
const isLiveKey = (k) => /^(sk|rk)_live_/.test(k || '');

function setEnv(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;
}

async function findPrice(stripe) {
  return (await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 })).data[0];
}

async function findEndpoint(stripe) {
  return (await stripe.webhookEndpoints.list({ limit: 100 })).data.find(
    (e) => e.url === WEBHOOK_URL,
  );
}

async function staleCustomers(stripe) {
  const client = await MongoClient.connect(process.env.ATLAS_URI);
  const users = client.db(DB_NAME).collection('users');
  const withCust = await users
    .find(
      { 'subscription.stripeCustomerId': { $exists: true, $ne: null } },
      {
        projection: { 'subscription.stripeCustomerId': 1, 'subscription.stripeSubscriptionId': 1 },
      },
    )
    .toArray();
  const stale = [];
  for (const u of withCust) {
    try {
      await stripe.customers.retrieve(u.subscription.stripeCustomerId);
    } catch (e) {
      if (e.code === 'resource_missing') stale.push(u);
      else throw e;
    }
  }
  return { client, users, withCust, stale };
}

async function plan(key) {
  const stripe = Stripe(key);
  try {
    const acct = await stripe.accounts.retrieve();
    console.log(`account: ${acct.id} (${acct.business_profile?.name || acct.email || 'unnamed'})`);
    console.log(
      `charges_enabled: ${acct.charges_enabled}  payouts_enabled: ${acct.payouts_enabled}`,
    );
    if (!acct.charges_enabled)
      console.log(
        'WARNING: live charges are not enabled — finish account activation in the Stripe dashboard.',
      );
  } catch {
    console.log('account: (key cannot read account details — check activation in the dashboard)');
  }

  const price = await findPrice(stripe);
  console.log(price ? `price: reuse ${price.id}` : 'price: CREATE TrickBook Plus $10.00/month');

  const ep = await findEndpoint(stripe);
  if (ep) {
    const missing = EVENTS.filter(
      (e) => !ep.enabled_events.includes(e) && !ep.enabled_events.includes('*'),
    );
    console.log(
      `webhook: reuse ${ep.id} (${ep.status})${missing.length ? `, will ADD events: ${missing.join(',')}` : ''}`,
    );
    console.log('WEBHOOK_EXISTS'); // tells the shell script to prompt for this endpoint's signing secret
  } else console.log(`webhook: CREATE ${WEBHOOK_URL}`);

  const { client, withCust, stale } = await staleCustomers(stripe);
  await client.close();
  console.log(
    `users with a Stripe customer id: ${withCust.length}; test-mode ids to clear: ${stale.length}`,
  );
  console.log(
    `current server key mode: ${isLiveKey(process.env.STRIPE_SECRET_KEY) ? 'LIVE' : 'TEST'}`,
  );
}

async function apply(key, whsecIn) {
  const stripe = Stripe(key);

  let price = await findPrice(stripe);
  if (!price) {
    const product = await stripe.products.create({
      name: 'TrickBook Plus',
      description: 'Unlimited spots, lists, and verified badge',
    });
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: 1000,
      currency: 'usd',
      recurring: { interval: 'month' },
      lookup_key: LOOKUP_KEY,
    });
    console.log(`price created: ${price.id}`);
  } else console.log(`price reused: ${price.id}`);

  let whsec = whsecIn;
  const ep = await findEndpoint(stripe);
  if (ep) {
    if (!/^whsec_/.test(whsec || ''))
      throw new Error('endpoint exists but no valid signing secret was supplied');
    const events = [...new Set([...ep.enabled_events, ...EVENTS])];
    await stripe.webhookEndpoints.update(ep.id, { enabled_events: events, disabled: false });
    console.log(`webhook reused: ${ep.id}`);
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: WEBHOOK_URL,
      enabled_events: EVENTS,
      description: 'TB-Backend production',
    });
    whsec = created.secret;
    console.log(`webhook created: ${created.id}`);
  }

  const { client, users, stale } = await staleCustomers(stripe);
  const clearable = stale.filter((u) => !u.subscription.stripeSubscriptionId);
  if (clearable.length) {
    const r = await users.updateMany(
      { _id: { $in: clearable.map((u) => u._id) } },
      { $unset: { 'subscription.stripeCustomerId': '' } },
    );
    console.log(`cleared test-mode customer ids: ${r.modifiedCount}`);
  }
  if (stale.length > clearable.length) {
    console.log(
      `NOTE: ${stale.length - clearable.length} user(s) hold a test subscription id — left untouched, review manually.`,
    );
  }
  await client.close();

  const backup = `.env.bak-stripe-test-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync('.env', backup);
  fs.chmodSync(backup, 0o600);
  let env = fs.readFileSync('.env', 'utf8');
  env = setEnv(env, 'STRIPE_SECRET_KEY', key);
  env = setEnv(env, 'STRIPE_WEBHOOK_SECRET', whsec);
  env = setEnv(env, 'STRIPE_PREMIUM_PRICE_ID', price.id);
  fs.writeFileSync('.env', env, { mode: 0o600 });
  console.log(`.env updated (rollback: cp ${backup} .env && pm2 restart TB-Backend)`);
}

async function verify() {
  const key = process.env.STRIPE_SECRET_KEY;
  const stripe = Stripe(key);
  let ok = true;
  const check = (cond, msg) => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
    ok = ok && cond;
  };
  check(isLiveKey(key), 'STRIPE_SECRET_KEY is a live key');
  check(/^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || ''), 'STRIPE_WEBHOOK_SECRET is set');
  const price = await stripe.prices.retrieve(process.env.STRIPE_PREMIUM_PRICE_ID);
  check(
    price.livemode && price.active,
    `price ${price.id} live+active (${price.unit_amount} ${price.currency}/${price.recurring?.interval})`,
  );
  const ep = await findEndpoint(stripe);
  check(ep && ep.status === 'enabled', `webhook endpoint enabled${ep ? ` (${ep.id})` : ''}`);
  if (ep)
    check(
      EVENTS.every((e) => ep.enabled_events.includes(e) || ep.enabled_events.includes('*')),
      'webhook subscribed to all handled events',
    );
  process.exitCode = ok ? 0 : 1;
}

(async () => {
  if (mode === '--verify') return verify();
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (!isLiveKey(input.key))
    throw new Error('not a live secret key (expected sk_live_ or rk_live_)');
  if (mode === '--plan') return plan(input.key);
  if (mode === '--apply') return apply(input.key, input.whsec);
  throw new Error('usage: --plan | --apply | --verify');
})().catch((e) => {
  console.error(`ERROR: ${e.type || ''} ${e.message}`);
  process.exit(1);
});
