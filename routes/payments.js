const express = require('express');
const { ObjectId } = require('mongodb');
const defaultStripe = require('../config/stripe');
const auth = require('../middleware/auth');

const EVENTS_COLLECTION = 'stripe_events';
const EVENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;

function frontendUrl() {
  return process.env.FRONTEND_URL || 'https://thetrickbook.com';
}

function periodEnd(subscription) {
  const seconds = subscription?.current_period_end;
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

// Map a Stripe subscription onto the fields middleware/subscription.js reads.
// "canceled" here means cancel-at-period-end with access still running; a fully
// ended subscription arrives as customer.subscription.deleted and drops to free.
function premiumFields(subscription) {
  const fields = {
    'subscription.plan': 'premium',
    'subscription.status': subscription.cancel_at_period_end
      ? 'canceled'
      : subscription.status === 'trialing'
        ? 'active'
        : subscription.status,
    'subscription.stripeSubscriptionId': subscription.id,
  };
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (customerId) fields['subscription.stripeCustomerId'] = customerId;
  const end = periodEnd(subscription);
  if (end) fields['subscription.currentPeriodEnd'] = end;
  return fields;
}

module.exports = (db, options = {}) => {
  const stripe = options.stripe || defaultStripe;
  const router = express.Router();
  const usersCollection = db.collection('users');
  const eventsCollection = db.collection(EVENTS_COLLECTION);

  if (typeof eventsCollection.createIndex === 'function') {
    eventsCollection.createIndex({ eventId: 1 }, { unique: true }).catch(() => {});
    eventsCollection
      .createIndex({ receivedAt: 1 }, { expireAfterSeconds: EVENT_RETENTION_SECONDS })
      .catch(() => {});
  }

  router.use((_req, res, next) => {
    if (!stripe) {
      return res.status(503).send({ error: 'Stripe is not configured' });
    }
    next();
  });

  async function findUser(userId) {
    if (!ObjectId.isValid(userId)) return null;
    return usersCollection.findOne({ _id: new ObjectId(userId) });
  }

  async function applySubscription(userId, subscription) {
    if (!subscription || !LIVE_STATUSES.has(subscription.status)) return false;
    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: premiumFields(subscription) },
    );
    return true;
  }

  // Create checkout session
  router.post('/create-checkout-session', [auth], async (req, res) => {
    try {
      const user = await findUser(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Create or get Stripe customer
      let customerId = user.subscription?.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: {
            userId: req.user.userId,
          },
        });

        customerId = customer.id;

        // Update user with customer ID
        await usersCollection.updateOne(
          { _id: new ObjectId(req.user.userId) },
          { $set: { 'subscription.stripeCustomerId': customerId } },
        );
      }

      // Create checkout session
      // Use pre-created price ID if available, otherwise create price dynamically
      const lineItems = process.env.STRIPE_PREMIUM_PRICE_ID
        ? [{ price: process.env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }]
        : [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: 'TrickBook Plus',
                  description: 'Unlimited spots, lists, and verified badge',
                },
                unit_amount: 1000, // $10.00 in cents
                recurring: { interval: 'month' },
              },
              quantity: 1,
            },
          ];

      // The session id in the success URL lets the site confirm the purchase
      // server-side (GET /verify-session) instead of trusting ?success=true.
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'subscription',
        success_url: `${frontendUrl()}/settings?tab=billing&success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl()}/settings?tab=billing`,
        metadata: {
          userId: req.user.userId,
        },
      });

      res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get user's subscription status
  router.get('/subscription', [auth], async (req, res) => {
    try {
      const user = await findUser(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const subscription = user.subscription || {
        plan: 'free',
        status: 'active',
      };

      res.json({ subscription, isAdmin: user.role === 'admin' });
    } catch (error) {
      console.error('Error getting subscription:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Confirm a Checkout Session after Stripe redirects back. Only the account that
  // started the session may confirm it, and only a paid session activates anything.
  router.get('/verify-session', [auth], async (req, res) => {
    const sessionId = String(req.query.session_id || '');
    if (!SESSION_ID.test(sessionId)) {
      return res.status(400).json({ error: 'A Stripe checkout session id is required.' });
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription'],
      });
      if (session.metadata?.userId !== req.user.userId) {
        return res.status(403).json({ error: 'This checkout session belongs to another account.' });
      }
      const paid = session.payment_status === 'paid' || session.status === 'complete';
      const subscription =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;
      const activated = paid ? await applySubscription(req.user.userId, subscription) : false;
      const user = await findUser(req.user.userId);
      res.json({
        verified: activated,
        paymentStatus: session.payment_status,
        subscription: user?.subscription || { plan: 'free', status: 'active' },
      });
    } catch (error) {
      console.error('Error verifying checkout session:', error.message);
      res.status(502).json({ error: 'Could not confirm the checkout session with Stripe.' });
    }
  });

  // Re-read the account's subscriptions from Stripe and apply any live one. This
  // repairs accounts that paid while webhook deliveries were failing. It never
  // downgrades; customer.subscription.deleted owns that.
  router.post('/reconcile', [auth], async (req, res) => {
    try {
      const user = await findUser(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const customerId = user.subscription?.stripeCustomerId;
      let reconciled = false;
      if (customerId) {
        const { data } = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 10,
        });
        const live = data.find((subscription) => LIVE_STATUSES.has(subscription.status));
        reconciled = await applySubscription(req.user.userId, live);
      }
      const fresh = reconciled ? await findUser(req.user.userId) : user;
      res.json({
        reconciled,
        subscription: fresh.subscription || { plan: 'free', status: 'active' },
      });
    } catch (error) {
      console.error('Error reconciling subscription:', error.message);
      res.status(502).json({ error: 'Could not read subscriptions from Stripe.' });
    }
  });

  // Admin: Toggle subscription override for testing
  router.post('/admin/toggle-subscription', [auth], async (req, res) => {
    try {
      const { override } = req.body; // "free", "premium", or null (to clear override)

      const user = await findUser(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Only admins can use this endpoint
      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      // Update or clear the admin override
      if (override === null || override === undefined) {
        await usersCollection.updateOne(
          { _id: new ObjectId(req.user.userId) },
          { $unset: { 'subscription.adminOverride': '' } },
        );
      } else {
        await usersCollection.updateOne(
          { _id: new ObjectId(req.user.userId) },
          { $set: { 'subscription.adminOverride': override } },
        );
      }

      const updatedUser = await findUser(req.user.userId);

      res.json({
        message: `Admin override ${override ? `set to ${override}` : 'cleared'}`,
        subscription: updatedUser.subscription,
      });
    } catch (error) {
      console.error('Error toggling admin subscription:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Cancel subscription
  router.post('/cancel-subscription', [auth], async (req, res) => {
    try {
      const user = await findUser(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.subscription?.stripeSubscriptionId) {
        return res.status(400).json({ error: 'No active subscription found' });
      }

      // Cancel subscription in Stripe
      await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      // Update user subscription status
      await usersCollection.updateOne(
        { _id: new ObjectId(req.user.userId) },
        { $set: { 'subscription.status': 'canceled' } },
      );

      res.json({
        message: 'Subscription will be canceled at the end of the current period',
      });
    } catch (error) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Reactivate subscription
  router.post('/reactivate-subscription', [auth], async (req, res) => {
    try {
      const user = await findUser(req.user.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.subscription?.stripeSubscriptionId) {
        return res.status(400).json({ error: 'No subscription found' });
      }

      // Reactivate subscription in Stripe
      await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      // Update user subscription status
      await usersCollection.updateOne(
        { _id: new ObjectId(req.user.userId) },
        { $set: { 'subscription.status': 'active' } },
      );

      res.json({ message: 'Subscription reactivated successfully' });
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Records an event id before handling it. A duplicate delivery returns false;
  // a handler failure releases the claim so Stripe's retry can run it again.
  async function claimEvent(event) {
    try {
      await eventsCollection.insertOne({
        eventId: event.id,
        type: event.type,
        livemode: Boolean(event.livemode),
        receivedAt: new Date(),
      });
      return true;
    } catch (error) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  // Stripe webhook handler. index.js mounts express.raw for this path ahead of
  // the JSON parser, so req.body is the signed bytes; the parser here is a guard
  // for any other mount.
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (!(await claimEvent(event))) {
        return res.json({ received: true, duplicate: true });
      }
    } catch (error) {
      console.error('Webhook event claim failed:', error.message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          await handleCheckoutCompleted(event.data.object);
          break;
        }

        case 'customer.subscription.updated': {
          await handleSubscriptionUpdated(event.data.object);
          break;
        }

        case 'customer.subscription.deleted': {
          await handleSubscriptionDeleted(event.data.object);
          break;
        }

        case 'invoice.payment_succeeded': {
          await handlePaymentSucceeded(event.data.object);
          break;
        }

        case 'invoice.payment_failed': {
          await handlePaymentFailed(event.data.object);
          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      await eventsCollection.deleteOne({ eventId: event.id }).catch(() => {});
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  async function handleCheckoutCompleted(session) {
    const userId = session.metadata?.userId;
    if (!userId || !ObjectId.isValid(userId)) {
      console.error(`checkout.session.completed ${session.id} carries no TrickBook userId`);
      return;
    }
    if (session.mode !== 'subscription' || !session.subscription) return;

    // Checkout sessions reference the subscription by id; the period end lives on
    // the subscription object itself.
    const subscription =
      typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
    const activated = await applySubscription(userId, subscription);
    console.log(`User ${userId} subscription ${activated ? 'activated' : 'not live yet'}`);
  }

  async function handleSubscriptionUpdated(subscription) {
    const user = await usersCollection.findOne({
      'subscription.stripeSubscriptionId': subscription.id,
    });

    if (user) {
      const set = {
        'subscription.status': subscription.cancel_at_period_end ? 'canceled' : subscription.status,
      };
      const end = periodEnd(subscription);
      if (end) set['subscription.currentPeriodEnd'] = end;
      await usersCollection.updateOne({ _id: user._id }, { $set: set });

      console.log(`Subscription ${subscription.id} updated for user ${user._id}`);
    }
  }

  async function handleSubscriptionDeleted(subscription) {
    const user = await usersCollection.findOne({
      'subscription.stripeSubscriptionId': subscription.id,
    });

    if (user) {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'subscription.status': 'canceled',
            'subscription.plan': 'free',
          },
        },
      );

      console.log(`Subscription ${subscription.id} canceled for user ${user._id}`);
    }
  }

  async function handlePaymentSucceeded(invoice) {
    const user = await usersCollection.findOne({
      'subscription.stripeSubscriptionId': invoice.subscription,
    });

    if (user) {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'subscription.status': 'active',
            'subscription.lastPaymentDate': new Date(),
          },
        },
      );

      console.log(`Payment succeeded for user ${user._id}`);
    }
  }

  async function handlePaymentFailed(invoice) {
    const user = await usersCollection.findOne({
      'subscription.stripeSubscriptionId': invoice.subscription,
    });

    if (user) {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'subscription.status': 'past_due',
          },
        },
      );

      console.log(`Payment failed for user ${user._id}`);
    }
  }

  return router;
};

module.exports.premiumFields = premiumFields;
module.exports.periodEnd = periodEnd;
module.exports.EVENTS_COLLECTION = EVENTS_COLLECTION;
