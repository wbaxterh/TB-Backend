const express = require("express");
const router = express.Router();
const { MongoClient, ObjectId } = require("mongodb");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");
		const listingsCollection = db.collection("listings");
		const feedPostsCollection = db.collection("feed_posts");
		const spotsCollection = db.collection("spots");
		const reactionsCollection = db.collection("reactions");

		// Get current logged-in user's info
		router.get("/me", auth, async (req, res) => {
			try {
				const userId = req.user._id || req.user.userId;
				const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
				if (!user) return res.status(404).send("User not found");

				res.send({
					id: user._id,
					name: user.name,
					email: user.email,
					role: user.role,
					imageUri: user.imageUri,
					sports: user.sports,
					riderProfile: user.riderProfile,
					network: user.network,
				});
			} catch (error) {
				console.error("Error retrieving user", error);
				res.status(500).send("Internal Server Error");
			}
		});

		// Get user by ID (for settings page - requires auth)
		router.get("/:id", auth, async (req, res) => {
			const { id } = req.params;

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const user = await usersCollection.findOne(
					{ _id: new ObjectId(id) },
					{
						projection: {
							password: 0,
							resetToken: 0,
							resetTokenExpiry: 0,
						},
					}
				);

				if (!user) {
					return res.status(404).send({ error: "User not found" });
				}

				res.send(user);
			} catch (error) {
				console.error("Error getting user:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get public profile (no auth required)
		router.get("/:id/public", async (req, res) => {
			const { id } = req.params;

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const user = await usersCollection.findOne(
					{ _id: new ObjectId(id) },
					{
						projection: {
							name: 1,
							imageUri: 1,
							sports: 1,
							riderProfile: 1,
							createdAt: 1,
							network: 1,
						},
					}
				);

				if (!user) {
					return res.status(404).send({ error: "User not found" });
				}

				res.send(user);
			} catch (error) {
				console.error("Error getting public profile:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get user stats (love, respect, counts)
		router.get("/:id/stats", async (req, res) => {
			const { id } = req.params;

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				// Count tricklists
				const tricklistCount = await listingsCollection.countDocuments({
					userId: id,
				});

				// Count posts
				let postCount = 0;
				let totalLove = 0;
				let totalRespect = 0;

				try {
					postCount = await feedPostsCollection.countDocuments({
						userId: new ObjectId(id),
					});

					// Sum up love and respect from user's posts
					const postStats = await feedPostsCollection.aggregate([
						{ $match: { userId: new ObjectId(id) } },
						{
							$group: {
								_id: null,
								totalLove: { $sum: "$stats.loveCount" },
								totalRespect: { $sum: "$stats.respectCount" },
							},
						},
					]).toArray();

					if (postStats.length > 0) {
						totalLove = postStats[0].totalLove || 0;
						totalRespect = postStats[0].totalRespect || 0;
					}
				} catch (e) {
					// feed_posts collection might not exist yet
					console.log("Feed posts collection not available:", e.message);
				}

				// Count spots created by user
				let spotCount = 0;
				try {
					spotCount = await spotsCollection.countDocuments({
						createdBy: new ObjectId(id),
					});
				} catch (e) {
					// Try with string ID
					try {
						spotCount = await spotsCollection.countDocuments({
							createdBy: id,
						});
					} catch (e2) {
						console.log("Spots collection query failed:", e2.message);
					}
				}

				// Get homies count
				const user = await usersCollection.findOne(
					{ _id: new ObjectId(id) },
					{ projection: { homies: 1 } }
				);
				const homiesCount = (user?.homies || []).length;

				res.send({
					totalLove,
					totalRespect,
					tricklistCount,
					postCount,
					spotCount,
					homiesCount,
				});
			} catch (error) {
				console.error("Error getting user stats:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Update user profile
		router.put("/:id", auth, async (req, res) => {
			const { id } = req.params;
			const { name, sports, riderProfile, imageUri } = req.body;

			// Verify user is updating their own profile
			const currentUserId = req.user._id || req.user.userId;
			if (currentUserId !== id) {
				return res.status(403).send({ error: "Access denied" });
			}

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const updateFields = {};

				if (name !== undefined) updateFields.name = name;
				if (sports !== undefined) updateFields.sports = sports;
				if (riderProfile !== undefined) updateFields.riderProfile = riderProfile;
				if (imageUri !== undefined) updateFields.imageUri = imageUri;
				updateFields.updatedAt = new Date();

				const result = await usersCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $set: updateFields }
				);

				if (result.matchedCount === 0) {
					return res.status(404).send({ error: "User not found" });
				}

				res.send({ message: "Profile updated", updated: updateFields });
			} catch (error) {
				console.error("Error updating profile:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Check homie status with another user
		router.get("/homie-status/:targetId", auth, async (req, res) => {
			const { targetId } = req.params;
			const currentUserId = req.user._id || req.user.userId;

			if (!ObjectId.isValid(targetId)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const currentUser = await usersCollection.findOne(
					{ _id: new ObjectId(currentUserId) },
					{ projection: { homies: 1, homieRequests: 1 } }
				);

				if (!currentUser) {
					return res.status(404).send({ error: "User not found" });
				}

				// Check if already homies
				if (currentUser.homies?.includes(targetId)) {
					return res.send({ status: "homies" });
				}

				// Check if request pending
				if (currentUser.homieRequests?.sent?.includes(targetId)) {
					return res.send({ status: "pending" });
				}

				// Check if we received a request from them
				const receivedRequest = currentUser.homieRequests?.received?.find(
					(r) => r.from === targetId
				);
				if (receivedRequest) {
					return res.send({ status: "received" });
				}

				res.send({ status: "none" });
			} catch (error) {
				console.error("Error checking homie status:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
