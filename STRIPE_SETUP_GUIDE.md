# Stripe Setup Guide for Freemium Model

## 🎯 Overview

This guide will help you configure Stripe for your freemium model with the following pricing:

- **Free Tier**: 3 spot lists, 5 spots per list (15 total spots)
- **Premium Tier**: $9.99/month - Unlimited spot lists and spots

## 📋 Prerequisites

- ✅ Stripe account created
- ✅ Node.js backend with MongoDB
- ✅ Environment variables configured

## 🔧 Step 1: Stripe Dashboard Configuration

### 1.1 Create a Product

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Navigate to **Products** → **Add Product**
3. Fill in the details:
   - **Name**: "TrickBook Premium"
   - **Description**: "Unlimited spot lists and spots for TrickBook"
   - **Images**: Add your app logo (optional)

### 1.2 Create Pricing

1. Click **Add pricing** on your product
2. Configure the pricing:
   - **Pricing model**: Recurring
   - **Billing period**: Monthly
   - **Price**: $9.99 USD
   - **Currency**: USD
3. Save the pricing

### 1.3 Get Your API Keys

1. Go to **Developers** → **API keys**
2. Copy your keys:
   - **Publishable key** (starts with `pk_test_` or `pk_live_`)
   - **Secret key** (starts with `sk_test_` or `sk_live_`)

### 1.4 Get Your Price ID

1. Go to **Products** → Click on your "TrickBook Premium" product
2. Copy the **Price ID** (starts with `price_`)

## 🔧 Step 2: Environment Variables

Add these to your `.env` file:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_PREMIUM_PRICE_ID=price_your_price_id_here
FRONTEND_URL=https://thetrickbook.com

# Webhook Secret (we'll get this in the next step)
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

## 🔧 Step 3: Webhook Configuration

### 3.1 Create Webhook Endpoint

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Configure the endpoint:
   - **Endpoint URL**: `https://api.thetrickbook.com/api/payments/webhook`
   - **Events to send**: Select these events:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`

### 3.2 Get Webhook Secret

1. After creating the webhook, click on it
2. Go to **Signing secret**
3. Click **Reveal** and copy the secret
4. Add it to your `.env` file as `STRIPE_WEBHOOK_SECRET`

## 🔧 Step 4: Test the Integration

### 4.1 Test Card Numbers

Use these test card numbers in Stripe test mode:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0025 0000 3155`

### 4.2 Test the API Endpoints

#### Create Checkout Session

```bash
curl -X POST "https://api.thetrickbook.com/api/payments/create-checkout-session" \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{}'
```

#### Get Subscription Status

```bash
curl -X GET "https://api.thetrickbook.com/api/payments/subscription" \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

#### Get Usage

```bash
curl -X GET "https://api.thetrickbook.com/api/spotlists/usage" \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

## 🔧 Step 5: Frontend Integration

### 5.1 Chrome Extension Integration

Add this to your Chrome extension's popup.js:

```javascript
// Create checkout session
async function createCheckoutSession() {
	try {
		const response = await fetch(
			"https://api.thetrickbook.com/api/payments/create-checkout-session",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-auth-token": await getAuthToken(),
				},
			}
		);

		const data = await response.json();

		if (data.sessionId) {
			// Redirect to Stripe Checkout
			window.open(
				`https://checkout.stripe.com/pay/${data.sessionId}`,
				"_blank"
			);
		}
	} catch (error) {
		console.error("Error creating checkout session:", error);
	}
}

// Check subscription status
async function checkSubscription() {
	try {
		const response = await fetch(
			"https://api.thetrickbook.com/api/payments/subscription",
			{
				headers: {
					"x-auth-token": await getAuthToken(),
				},
			}
		);

		const data = await response.json();
		return data.subscription;
	} catch (error) {
		console.error("Error checking subscription:", error);
		return { plan: "free", status: "active" };
	}
}

// Show upgrade prompt
function showUpgradePrompt(message) {
	const upgradeModal = document.createElement("div");
	upgradeModal.className = "modal";
	upgradeModal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🚀 Upgrade to Premium</h3>
      </div>
      <div class="modal-body">
        <p>${message}</p>
        <div class="pricing">
          <h4>Premium Features:</h4>
          <ul>
            <li>✅ Unlimited spot lists</li>
            <li>✅ Unlimited spots per list</li>
            <li>✅ Priority support</li>
            <li>✅ Advanced features</li>
          </ul>
          <p class="price">💳 $9.99/month</p>
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
		createCheckoutSession();
		upgradeModal.remove();
	};

	document.getElementById("cancelUpgrade").onclick = () => {
		upgradeModal.remove();
	};
}
```

### 5.2 Error Handling

Update your API error handling to show upgrade prompts:

```javascript
function handleApiError(error) {
	if (
		error.message.includes("upgradeRequired") ||
		error.message.includes("limit reached")
	) {
		showUpgradePrompt(
			"You've reached the free tier limit. Upgrade to continue!"
		);
	} else {
		showStatus(error.message, "error");
	}
}
```

## 🔧 Step 6: Production Deployment

### 6.1 Switch to Live Mode

1. In Stripe Dashboard, toggle from **Test mode** to **Live mode**
2. Update your environment variables with live keys:
   - `STRIPE_SECRET_KEY` → `sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY` → `pk_live_...`
   - `STRIPE_PREMIUM_PRICE_ID` → Live price ID
   - `STRIPE_WEBHOOK_SECRET` → Live webhook secret

### 6.2 Update Webhook URL

Update your webhook endpoint URL to your production domain:

- **Test**: `https://api.thetrickbook.com/api/payments/webhook`
- **Live**: `https://api.thetrickbook.com/api/payments/webhook` (same, but with live keys)

## 🔧 Step 7: Monitoring & Analytics

### 7.1 Stripe Dashboard

Monitor your subscriptions in:

- **Customers** → View all customers and their subscription status
- **Subscriptions** → Track active, canceled, and past due subscriptions
- **Payments** → View successful and failed payments
- **Webhooks** → Monitor webhook delivery status

### 7.2 Usage Analytics

Track user engagement with the usage endpoint:

```bash
# Get usage statistics
curl -X GET "https://api.thetrickbook.com/api/spotlists/usage" \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

## 🚀 Next Steps

1. **Test the integration** with test cards
2. **Deploy to production** with live Stripe keys
3. **Monitor webhook delivery** in Stripe dashboard
4. **Set up analytics** to track conversion rates
5. **Implement App Store/Google Play** payment integration

## 📞 Support

If you encounter issues:

1. Check Stripe Dashboard logs
2. Verify webhook delivery status
3. Test with Stripe's test cards
4. Check your server logs for errors

Your freemium model is now ready to generate revenue! 🎉
