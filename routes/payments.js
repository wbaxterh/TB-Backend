const express = require('express');
const stripe = require('../config/stripe');
const auth = require('../middleware/auth');
const { ObjectId } = require('mongodb');

module.exports = (db) => {
  const router = express.Router();
  const usersCollection = db.collection('users');

  // Create checkout session
  router.post('/create-checkout-session', [auth], async (req, res) => {
    try {
      const user = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'subscription',
        success_url: `${
          process.env.FRONTEND_URL || 'https://thetrickbook.com'
        }/settings?tab=billing&success=true`,
        cancel_url: `${process.env.FRONTEND_URL || 'https://thetrickbook.com'}/settings?tab=billing`,
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
      const user = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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

  // Admin: Toggle subscription override for testing
  router.post('/admin/toggle-subscription', [auth], async (req, res) => {
    try {
      const { override } = req.body; // "free", "premium", or null (to clear override)

      const user = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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

      const updatedUser = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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
      const user = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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
      const user = await usersCollection.findOne({
        _id: new ObjectId(req.user.userId),
      });

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

  // Stripe webhook handler
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
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          await handleCheckoutCompleted(session, db, usersCollection);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          await handleSubscriptionUpdated(subscription, db, usersCollection);
          break;
        }

        case 'customer.subscription.deleted': {
          const deletedSubscription = event.data.object;
          await handleSubscriptionDeleted(deletedSubscription, db, usersCollection);
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object;
          await handlePaymentSucceeded(invoice, db, usersCollection);
          break;
        }

        case 'invoice.payment_failed': {
          const failedInvoice = event.data.object;
          await handlePaymentFailed(failedInvoice, db, usersCollection);
          break;
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  async function handleCheckoutCompleted(session, _db, usersCollection) {
    const userId = session.metadata.userId;

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          'subscription.status': 'active',
          'subscription.plan': 'premium',
          'subscription.stripeSubscriptionId': session.subscription,
          'subscription.currentPeriodEnd': new Date(session.subscription.current_period_end * 1000),
        },
      },
    );

    console.log(`User ${userId} subscription activated`);
  }

  async function handleSubscriptionUpdated(subscription, _db, usersCollection) {
    const user = await usersCollection.findOne({
      'subscription.stripeSubscriptionId': subscription.id,
    });

    if (user) {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            'subscription.status': subscription.status,
            'subscription.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
          },
        },
      );

      console.log(`Subscription ${subscription.id} updated for user ${user._id}`);
    }
  }

  async function handleSubscriptionDeleted(subscription, _db, usersCollection) {
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

  async function handlePaymentSucceeded(invoice, _db, usersCollection) {
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

  async function handlePaymentFailed(invoice, _db, usersCollection) {
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
