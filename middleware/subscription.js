const { MongoClient, ObjectId } = require("mongodb");
const connectionString = process.env.ATLAS_URI;

const FREE_TIER_LIMITS = {
	maxSpotLists: 3,
	maxSpotsPerList: 5,
	maxTotalSpots: 15,
};

// Helper to check if user has premium access (includes admin override)
function hasPremiumAccess(user) {
	// Admins can override their subscription status for testing
	if (user.role === "admin" && user.subscription?.adminOverride !== undefined) {
		return user.subscription.adminOverride === "premium";
	}
	// Normal premium check
	return (
		user.subscription?.plan === "premium" &&
		["active", "canceled"].includes(user.subscription?.status)
	);
}

module.exports = {
	hasPremiumAccess,
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
			if (hasPremiumAccess(user)) {
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
			if (hasPremiumAccess(user)) {
				return next();
			}

			const { id: listId } = req.params;

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
			if (hasPremiumAccess(user)) {
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

			const isPremium = hasPremiumAccess(user);
			const usage = {
				spotListsCount: spotLists.length,
				totalSpotsCount: totalSpotsCount,
				subscription: user.subscription || { plan: "free", status: "active" },
				isPremium: isPremium,
				isAdmin: user.role === "admin",
				adminOverride: user.subscription?.adminOverride,
				limits: isPremium
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
