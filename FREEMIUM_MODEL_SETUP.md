# Freemium Model Implementation Guide

## Overview

Implement a freemium model with the following tiers:

- **Free Tier**: 3 spot lists, 5 spots per list (15 total spots)
- **Premium Tier**: Unlimited spot lists and spots

## 1. Stripe Integration Setup

### Install Dependencies

```bash
npm install stripe
```

### Environment Variables

Add to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Stripe Configuration (config/stripe.js)

```javascript
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = stripe;
```

## 2. User Model Updates

### Add Subscription Fields to User Schema

```javascript
// In your user model or schema
{
  _id: ObjectId,
  email: String,
  name: String,
  // ... existing fields

  // Subscription fields
  subscription: {
    status: String, // 'free', 'active', 'canceled', 'past_due'
    stripeCustomerId: String,
    stripeSubscriptionId: String,
    currentPeriodEnd: Date,
    plan: String // 'free', 'premium'
  },

  // Usage tracking
  usage: {
    spotListsCount: Number,
    totalSpotsCount: Number,
    lastResetDate: Date
  }
}
```

## 3. Subscription Middleware

### Create subscription middleware (middleware/subscription.js)

```javascript
const { MongoClient, ObjectId } = require("mongodb");
const connectionString = process.env.ATLAS_URI;

const FREE_TIER_LIMITS = {
	maxSpotLists: 3,
	maxSpotsPerList: 5,
	maxTotalSpots: 15,
};

module.exports = {
	// Check if user can create more spot lists
	async checkSpotListLimit(req, res, next) {
		try {
			const client = await MongoClient.connect(connectionString, {
				useUnifiedTopology: true,
			});
			const db = client.db("TrickList2");
			const usersCollection = db.collection("users");

			const user = await usersCollection.findOne({
				_id: ObjectId(req.user.userId),
			});

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			// Premium users have no limits
			if (
				user.subscription?.plan === "premium" &&
				user.subscription?.status === "active"
			) {
				return next();
			}

			// Check spot list count for free users
			const spotListsCount = await db.collection("spotlists").countDocuments({
				userId: req.user.userId,
			});

			if (spotListsCount >= FREE_TIER_LIMITS.maxSpotLists) {
				return res.status(403).json({
					error: "Spot list limit reached",
					limit: FREE_TIER_LIMITS.maxSpotLists,
					current: spotListsCount,
					upgradeRequired: true,
				});
			}

			next();
		} catch (error) {
			console.error("Error checking spot list limit:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	},

	// Check if user can add more spots to a list
	async checkSpotLimit(req, res, next) {
		try {
			const client = await MongoClient.connect(connectionString, {
				useUnifiedTopology: true,
			});
			const db = client.db("TrickList2");
			const usersCollection = db.collection("users");

			const user = await usersCollection.findOne({
				_id: ObjectId(req.user.userId),
			});

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			// Premium users have no limits
			if (
				user.subscription?.plan === "premium" &&
				user.subscription?.status === "active"
			) {
				return next();
			}

			const { listId } = req.params;

			// Get current spot count in the list
			const spotList = await db.collection("spotlists").findOne({
				_id: ObjectId(listId),
				userId: req.user.userId,
			});

			if (!spotList) {
				return res.status(404).json({ error: "Spot list not found" });
			}

			const currentSpotsCount = spotList.spotIds?.length || 0;

			if (currentSpotsCount >= FREE_TIER_LIMITS.maxSpotsPerList) {
				return res.status(403).json({
					error: "Spot limit reached for this list",
					limit: FREE_TIER_LIMITS.maxSpotsPerList,
					current: currentSpotsCount,
					upgradeRequired: true,
				});
			}

			next();
		} catch (error) {
			console.error("Error checking spot limit:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	},

	// Check total spots limit
	async checkTotalSpotsLimit(req, res, next) {
		try {
			const client = await MongoClient.connect(connectionString, {
				useUnifiedTopology: true,
			});
			const db = client.db("TrickList2");
			const usersCollection = db.collection("users");

			const user = await usersCollection.findOne({
				_id: ObjectId(req.user.userId),
			});

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			// Premium users have no limits
			if (
				user.subscription?.plan === "premium" &&
				user.subscription?.status === "active"
			) {
				return next();
			}

			// Count total spots across all user's lists
			const spotLists = await db
				.collection("spotlists")
				.find({
					userId: req.user.userId,
				})
				.toArray();

			const totalSpotsCount = spotLists.reduce((total, list) => {
				return total + (list.spotIds?.length || 0);
			}, 0);

			if (totalSpotsCount >= FREE_TIER_LIMITS.maxTotalSpots) {
				return res.status(403).json({
					error: "Total spots limit reached",
					limit: FREE_TIER_LIMITS.maxTotalSpots,
					current: totalSpotsCount,
					upgradeRequired: true,
				});
			}

			next();
		} catch (error) {
			console.error("Error checking total spots limit:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	},

	// Get user's current usage
	async getUserUsage(req, res) {
		try {
			const client = await MongoClient.connect(connectionString, {
				useUnifiedTopology: true,
			});
			const db = client.db("TrickList2");
			const usersCollection = db.collection("users");

			const user = await usersCollection.findOne({
				_id: ObjectId(req.user.userId),
			});

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			// Count user's spot lists and spots
			const spotLists = await db
				.collection("spotlists")
				.find({
					userId: req.user.userId,
				})
				.toArray();

			const totalSpotsCount = spotLists.reduce((total, list) => {
				return total + (list.spotIds?.length || 0);
			}, 0);

			const usage = {
				spotListsCount: spotLists.length,
				totalSpotsCount: totalSpotsCount,
				subscription: user.subscription || { plan: "free", status: "active" },
				limits:
					user.subscription?.plan === "premium"
						? {
								maxSpotLists: "unlimited",
								maxSpotsPerList: "unlimited",
								maxTotalSpots: "unlimited",
						  }
						: FREE_TIER_LIMITS,
			};

			res.json(usage);
		} catch (error) {
			console.error("Error getting user usage:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	},
};
```

## 4. Update Spot Lists Route

### Add limits to spotlists.js

```javascript
const subscriptionMiddleware = require("../middleware/subscription");

// Add middleware to routes
router.post(
	"/",
	[auth, subscriptionMiddleware.checkSpotListLimit, validateWith(schema)],
	async (req, res) => {
		// ... existing code
	}
);

router.post(
	"/:id/spots",
	[
		auth,
		subscriptionMiddleware.checkSpotLimit,
		subscriptionMiddleware.checkTotalSpotsLimit,
	],
	async (req, res) => {
		// ... existing code
	}
);

// Add usage endpoint
router.get("/usage", [auth], subscriptionMiddleware.getUserUsage);
```

## 5. Stripe Payment Routes

### Create payment routes (routes/payments.js)

```javascript
const express = require("express");
const router = express.Router();
const stripe = require("../config/stripe");
const auth = require("../middleware/auth");
const { MongoClient, ObjectId } = require("mongodb");
const connectionString = process.env.ATLAS_URI;

// Create checkout session
router.post("/create-checkout-session", [auth], async (req, res) => {
	try {
		const client = await MongoClient.connect(connectionString, {
			useUnifiedTopology: true,
		});
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");

		const user = await usersCollection.findOne({
			_id: ObjectId(req.user.userId),
		});

		if (!user) {
			return res.status(404).json({ error: "User not found" });
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
				{ _id: ObjectId(req.user.userId) },
				{ $set: { "subscription.stripeCustomerId": customerId } }
			);
		}

		// Create checkout session
		const session = await stripe.checkout.sessions.create({
			customer: customerId,
			payment_method_types: ["card"],
			line_items: [
				{
					price: process.env.STRIPE_PREMIUM_PRICE_ID, // Set this in your Stripe dashboard
					quantity: 1,
				},
			],
			mode: "subscription",
			success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
			metadata: {
				userId: req.user.userId,
			},
		});

		res.json({ sessionId: session.id });
	} catch (error) {
		console.error("Error creating checkout session:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});

// Stripe webhook handler
router.post(
	"/webhook",
	express.raw({ type: "application/json" }),
	async (req, res) => {
		const sig = req.headers["stripe-signature"];
		let event;

		try {
			event = stripe.webhooks.constructEvent(
				req.body,
				sig,
				process.env.STRIPE_WEBHOOK_SECRET
			);
		} catch (err) {
			console.error("Webhook signature verification failed:", err.message);
			return res.status(400).send(`Webhook Error: ${err.message}`);
		}

		try {
			const client = await MongoClient.connect(connectionString, {
				useUnifiedTopology: true,
			});
			const db = client.db("TrickList2");
			const usersCollection = db.collection("users");

			switch (event.type) {
				case "checkout.session.completed":
					const session = event.data.object;
					await handleCheckoutCompleted(session, db, usersCollection);
					break;

				case "customer.subscription.updated":
					const subscription = event.data.object;
					await handleSubscriptionUpdated(subscription, db, usersCollection);
					break;

				case "customer.subscription.deleted":
					const deletedSubscription = event.data.object;
					await handleSubscriptionDeleted(
						deletedSubscription,
						db,
						usersCollection
					);
					break;
			}

			res.json({ received: true });
		} catch (error) {
			console.error("Webhook error:", error);
			res.status(500).json({ error: "Webhook processing failed" });
		}
	}
);

async function handleCheckoutCompleted(session, db, usersCollection) {
	const userId = session.metadata.userId;

	await usersCollection.updateOne(
		{ _id: ObjectId(userId) },
		{
			$set: {
				"subscription.status": "active",
				"subscription.plan": "premium",
				"subscription.stripeSubscriptionId": session.subscription,
				"subscription.currentPeriodEnd": new Date(
					session.subscription.current_period_end * 1000
				),
			},
		}
	);
}

async function handleSubscriptionUpdated(subscription, db, usersCollection) {
	const user = await usersCollection.findOne({
		"subscription.stripeSubscriptionId": subscription.id,
	});

	if (user) {
		await usersCollection.updateOne(
			{ _id: user._id },
			{
				$set: {
					"subscription.status": subscription.status,
					"subscription.currentPeriodEnd": new Date(
						subscription.current_period_end * 1000
					),
				},
			}
		);
	}
}

async function handleSubscriptionDeleted(subscription, db, usersCollection) {
	const user = await usersCollection.findOne({
		"subscription.stripeSubscriptionId": subscription.id,
	});

	if (user) {
		await usersCollection.updateOne(
			{ _id: user._id },
			{
				$set: {
					"subscription.status": "canceled",
					"subscription.plan": "free",
				},
			}
		);
	}
}

module.exports = router;
```

## 6. Update Main App

### Add payment routes to index.js

```javascript
const payments = require("./routes/payments");

// Add this line with your other routes
app.use("/api/payments", payments);
```

## 7. Frontend Integration

### Add upgrade prompts to Chrome extension

```javascript
// Add to your popup.js
function showUpgradePrompt(message) {
	const upgradeModal = document.createElement("div");
	upgradeModal.className = "modal";
	upgradeModal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Upgrade to Premium</h3>
      </div>
      <div class="modal-body">
        <p>${message}</p>
        <div class="pricing">
          <h4>Premium Features:</h4>
          <ul>
            <li>Unlimited spot lists</li>
            <li>Unlimited spots per list</li>
            <li>Priority support</li>
          </ul>
          <p class="price">$9.99/month</p>
        </div>
      </div>
      <div class="modal-footer">
        <button id="upgradeBtn" class="btn btn-primary">Upgrade Now</button>
        <button id="cancelUpgrade" class="btn btn-secondary">Maybe Later</button>
      </div>
    </div>
  `;

	document.body.appendChild(upgradeModal);

	document.getElementById("upgradeBtn").onclick = () => {
		window.open("https://your-website.com/upgrade", "_blank");
		upgradeModal.remove();
	};

	document.getElementById("cancelUpgrade").onclick = () => {
		upgradeModal.remove();
	};
}

// Update error handling to show upgrade prompts
function handleApiError(error) {
	if (error.message.includes("upgradeRequired")) {
		showUpgradePrompt(
			"You've reached the free tier limit. Upgrade to continue!"
		);
	} else {
		showStatus(error.message, "error");
	}
}
```

## 8. Environment Variables

### Add to .env

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PREMIUM_PRICE_ID=price_...
FRONTEND_URL=https://your-website.com
```

## 9. Testing

### Test the limits

```bash
# Try to create more than 3 spot lists (should fail)
# Try to add more than 5 spots to a list (should fail)
# Check usage endpoint
curl -X GET "https://api.thetrickbook.com/api/spotlists/usage" \
  -H "x-auth-token: YOUR_TOKEN"
```

## 10. Stripe Dashboard Setup

1. **Create a product** in Stripe Dashboard
2. **Set up recurring pricing** ($9.99/month)
3. **Configure webhooks** for subscription events
4. **Get your API keys** and add them to .env

This implementation provides a complete freemium model with Stripe integration, usage limits, and upgrade prompts!
