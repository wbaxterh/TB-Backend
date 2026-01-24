const express = require("express");
const router = express.Router();
const { MongoClient, ObjectId } = require("mongodb");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");
		const tricklistsCollection = db.collection("tricklists");
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
							"subscription.plan": 1,
							"subscription.status": 1,
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
				// Count tricklists - uses DBRef format "user.$id"
				const tricklistCount = await tricklistsCollection.countDocuments({
					"user.$id": id,
				});

				// Count posts
				let postCount = 0;
				let totalLove = 0;
				let totalRespect = 0;

				try {
					// Debug: check what format userId is stored as
					const samplePost = await feedPostsCollection.findOne({});
					console.log("DEBUG Stats - searching for userId:", id, "type:", typeof id);
					console.log("DEBUG Stats - sample post userId:", samplePost?.userId, "type:", typeof samplePost?.userId);

					// Try both string and ObjectId formats
					const countByString = await feedPostsCollection.countDocuments({ userId: id });
					const countByObjectId = await feedPostsCollection.countDocuments({ userId: new ObjectId(id) });
					console.log("DEBUG Stats - count by string:", countByString, "count by ObjectId:", countByObjectId);

					postCount = countByString || countByObjectId;

					// Sum up love and respect from user's posts - try string first
					let postStats = await feedPostsCollection.aggregate([
						{ $match: { userId: id } },
						{
							$group: {
								_id: null,
								totalLove: { $sum: "$stats.loveCount" },
								totalRespect: { $sum: "$stats.respectCount" },
							},
						},
					]).toArray();

					// If no results with string, try ObjectId
					if (postStats.length === 0) {
						postStats = await feedPostsCollection.aggregate([
							{ $match: { userId: new ObjectId(id) } },
							{
								$group: {
									_id: null,
									totalLove: { $sum: "$stats.loveCount" },
									totalRespect: { $sum: "$stats.respectCount" },
								},
							},
						]).toArray();
					}

					if (postStats.length > 0) {
						totalLove = postStats[0].totalLove || 0;
						totalRespect = postStats[0].totalRespect || 0;
					}
					console.log("DEBUG Stats - totalLove:", totalLove, "totalRespect:", totalRespect);
				} catch (e) {
					// feed_posts collection might not exist yet
					console.log("Feed posts collection not available:", e.message);
				}

				// Count spots created by user - spots use userId as ObjectId
				let spotCount = 0;
				try {
					spotCount = await spotsCollection.countDocuments({
						userId: new ObjectId(id),
					});
				} catch (e) {
					console.log("Spots collection query failed:", e.message);
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

		// Get user activity feed (posts, reactions, comments)
		router.get("/:id/activity", async (req, res) => {
			const { id } = req.params;
			const { limit = 20, skip = 0 } = req.query;

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const activities = [];

				// Get user's posts
				try {
					const posts = await feedPostsCollection
						.find({ userId: id })
						.sort({ createdAt: -1 })
						.limit(10)
						.toArray();

					posts.forEach((post) => {
						activities.push({
							type: "post",
							action: "created a post",
							data: {
								_id: post._id,
								caption: post.caption,
								thumbnailUrl: post.thumbnailUrl,
								mediaType: post.mediaType,
								tricks: post.tricks,
								stats: post.stats,
							},
							createdAt: post.createdAt,
						});
					});
				} catch (e) {
					console.log("Feed posts query failed:", e.message);
				}

				// Get user's reactions on posts
				try {
					const reactions = await reactionsCollection
						.find({ userId: id })
						.sort({ createdAt: -1 })
						.limit(10)
						.toArray();

					// Get the posts that were reacted to
					const postIds = reactions
						.filter((r) => r.postId)
						.map((r) => {
							try {
								return new ObjectId(r.postId);
							} catch {
								return r.postId;
							}
						});

					const reactedPosts = await feedPostsCollection
						.find({ _id: { $in: postIds } })
						.toArray();

					const postMap = {};
					reactedPosts.forEach((p) => {
						postMap[p._id.toString()] = p;
					});

					reactions.forEach((reaction) => {
						const post = postMap[reaction.postId?.toString()];
						if (post) {
							activities.push({
								type: "reaction",
								action: reaction.type === "love" ? "loved a post" : "gave respect to a post",
								reactionType: reaction.type,
								data: {
									_id: post._id,
									caption: post.caption,
									thumbnailUrl: post.thumbnailUrl,
									userId: post.userId,
								},
								createdAt: reaction.createdAt,
							});
						}
					});
				} catch (e) {
					console.log("Reactions query failed:", e.message);
				}

				// Get user's comments
				try {
					const commentsCollection = feedPostsCollection.s.db.collection("feed_comments");
					const comments = await commentsCollection
						.find({ userId: id, isDeleted: { $ne: true } })
						.sort({ createdAt: -1 })
						.limit(10)
						.toArray();

					// Get the posts that were commented on
					const postIds = comments.map((c) => {
						try {
							return new ObjectId(c.postId);
						} catch {
							return c.postId;
						}
					});

					const commentedPosts = await feedPostsCollection
						.find({ _id: { $in: postIds } })
						.toArray();

					const postMap = {};
					commentedPosts.forEach((p) => {
						postMap[p._id.toString()] = p;
					});

					comments.forEach((comment) => {
						const post = postMap[comment.postId?.toString()];
						activities.push({
							type: "comment",
							action: "commented on a post",
							data: {
								_id: comment._id,
								content: comment.content,
								postId: comment.postId,
								postCaption: post?.caption,
								postThumbnail: post?.thumbnailUrl,
							},
							createdAt: comment.createdAt,
						});
					});
				} catch (e) {
					console.log("Comments query failed:", e.message);
				}

				// Get spots created by user
				try {
					const spots = await spotsCollection
						.find({ userId: new ObjectId(id) })
						.sort({ createdAt: -1 })
						.limit(5)
						.toArray();

					spots.forEach((spot) => {
						activities.push({
							type: "spot",
							action: "added a spot",
							data: {
								_id: spot._id,
								name: spot.name,
								city: spot.city,
								state: spot.state,
								thumbnailUrl: spot.images?.[0],
							},
							createdAt: spot.createdAt,
						});
					});
				} catch (e) {
					console.log("Spots query failed:", e.message);
				}

				// Sort all activities by date and paginate
				activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
				const paginatedActivities = activities.slice(
					parseInt(skip),
					parseInt(skip) + parseInt(limit)
				);

				res.send({
					activities: paginatedActivities,
					total: activities.length,
					hasMore: activities.length > parseInt(skip) + parseInt(limit),
				});
			} catch (error) {
				console.error("Error getting user activity:", error);
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
