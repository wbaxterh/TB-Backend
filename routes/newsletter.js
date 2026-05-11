const express = require('express');

module.exports = (db) => {
  const router = express.Router();
  const subscribersCollection = db.collection('newsletter_subscribers');

  // Subscribe to newsletter
  router.post('/subscribe', async (req, res) => {
    try {
      const { email, source } = req.body;

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
      }

      // Check if already subscribed
      const existing = await subscribersCollection.findOne({
        email: email.toLowerCase(),
      });

      if (existing) {
        return res.status(200).json({
          message: "You're already subscribed!",
          alreadySubscribed: true,
        });
      }

      // Add new subscriber
      const subscriber = {
        email: email.toLowerCase(),
        source: source || 'unknown',
        subscribedAt: new Date(),
        confirmed: false,
        tags: ['ai-tips'],
      };

      await subscribersCollection.insertOne(subscriber);

      // TODO: Send welcome email via SendGrid/Mailgun

      res.status(201).json({
        message: 'Successfully subscribed!',
        success: true,
      });
    } catch (error) {
      console.error('Newsletter subscribe error:', error);
      res.status(500).json({ error: 'Failed to subscribe' });
    }
  });

  // Get subscriber count (admin)
  router.get('/stats', async (_req, res) => {
    try {
      const count = await subscribersCollection.countDocuments();
      res.json({ subscriberCount: count });
    } catch (error) {
      console.error('Newsletter stats error:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  });

  // Unsubscribe
  router.post('/unsubscribe', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const result = await subscribersCollection.updateOne(
        { email: email.toLowerCase() },
        { $set: { unsubscribedAt: new Date(), active: false } },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Email not found' });
      }

      res.json({ message: 'Successfully unsubscribed' });
    } catch (error) {
      console.error('Newsletter unsubscribe error:', error);
      res.status(500).json({ error: 'Failed to unsubscribe' });
    }
  });

  return router;
};
