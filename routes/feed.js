/**
 * Feed Routes - "The Feed" Social API
 * Handles user-generated content, reactions, and comments
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { MongoClient } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;
const connectionString = process.env.ATLAS_URI;

// Socket emit functions for real-time updates
const {
	emitNewComment,
	emitCommentDeleted,
	emitCommentLoved,
} = require("../socket/feedSocket");

// Sport types enum
const SPORT_TYPES = [
	"skateboarding",
	"snowboarding",
	"skiing",
	"bmx",
	"mtb",
	"scooter",
	"surf",
	"wakeboarding",
	"rollerblading",
];

// Feed algorithm weights
const HOMIE_BOOST = 2.5;
const ENGAGEMENT_WEIGHT = 0.35;
const RECENCY_WEIGHT = 0.25;
const COMPLETION_WEIGHT = 0.25;
const INTERACTION_WEIGHT = 0.15;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const feedCollection = db.collection("feed_posts");
		const reactionsCollection = db.collection("reactions");
		const commentsCollection = db.collection("comments");
		const usersCollection = db.collection("users");
		const savedPostsCollection = db.collection("saved_posts");

		// Helper: Calculate feed score for ranking
		const calculateFeedScore = (post, userHomies, hoursOld) => {
			const isHomie = userHomies.includes(post.userId.toString());

			// Engagement score (normalized)
			const engagementScore =
				((post.stats?.loveCount || 0) * 1 +
					(post.stats?.respectCount || 0) * 1.5 +
					(post.stats?.commentCount || 0) * 3 +
					(post.stats?.shareCount || 0) * 2) /
				Math.max(post.stats?.viewCount || 1, 1);

			// Recency decay (exponential with 48 hour half-life)
			const recencyScore = Math.exp(-hoursOld / 48);

			// Completion rate
			const completionScore = post.engagement?.completionRate || 0.5;

			// Calculate base score
			let score =
				engagementScore * ENGAGEMENT_WEIGHT +
				recencyScore * RECENCY_WEIGHT +
				completionScore * COMPLETION_WEIGHT;

			// Apply homie boost
			if (isHomie) {
				score *= HOMIE_BOOST;
			}

			return score;
		};

		// Helper: Get user's homie IDs
		const getHomieIds = async (userId) => {
			const user = await usersCollection.findOne(
				{ _id: new ObjectId(userId) },
				{ projection: { homies: 1 } }
			);
			return user?.homies || [];
		};

		// Helper: Populate user data for posts
		const populatePostUsers = async (posts) => {
			const userIds = [...new Set(posts.map((p) => p.userId))];
			const users = await usersCollection
				.find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
				.project({ name: 1, email: 1, imageUri: 1 })
				.toArray();

			const userMap = {};
			users.forEach((u) => {
				userMap[u._id.toString()] = u;
			});

			return posts.map((post) => ({
				...post,
				user: userMap[post.userId] || { name: "Unknown" },
			}));
		};

		// =============================================
		// FEED ENDPOINTS
		// =============================================

		// Get algorithmic feed (homies prioritized)
		router.get("/", async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = Math.min(parseInt(req.query.limit) || 20, 50);
				const offset = (page - 1) * limit;

				// Get user's homies if authenticated
				let userHomies = [];
				let userId = null;
				if (req.headers["x-auth-token"]) {
					try {
						const jwt = require("jsonwebtoken");
						const decoded = jwt.verify(
							req.headers["x-auth-token"],
							process.env.JWT_SECRET || "jwtPrivateKey"
						);
						userId = decoded.userId;
						userHomies = await getHomieIds(userId);
					} catch (e) {
						// Invalid token, continue without auth
					}
				}

				// Get candidate posts (last 7 days)
				const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
				const query = {
					createdAt: { $gte: sevenDaysAgo },
					status: "published",
				};

				// Filter visibility based on auth
				if (userId) {
					query.$or = [
						{ visibility: "public" },
						{ visibility: "homies", userId: { $in: [userId, ...userHomies] } },
						{ userId: userId }, // Own posts
					];
				} else {
					query.visibility = "public";
				}

				let posts = await feedCollection.find(query).limit(500).toArray();

				// Score and sort posts
				const now = Date.now();
				const scoredPosts = posts.map((post) => {
					const hoursOld = (now - new Date(post.createdAt).getTime()) / 3600000;
					return {
						post,
						score: calculateFeedScore(post, userHomies, hoursOld),
					};
				});

				scoredPosts.sort((a, b) => b.score - a.score);

				// Paginate
				const paginatedPosts = scoredPosts
					.slice(offset, offset + limit)
					.map((s) => s.post);

				// Populate user data
				const populatedPosts = await populatePostUsers(paginatedPosts);

				// Add user's reactions if authenticated
				if (userId) {
					const postIds = populatedPosts.map((p) => p._id.toString());
					const userReactions = await reactionsCollection
						.find({
							postId: { $in: postIds },
							userId: userId,
						})
						.toArray();

					const reactionMap = {};
					userReactions.forEach((r) => {
						if (!reactionMap[r.postId]) reactionMap[r.postId] = [];
						reactionMap[r.postId].push(r.type);
					});

					populatedPosts.forEach((post) => {
						post.userReactions = reactionMap[post._id.toString()] || [];
					});
				}

				res.send({
					posts: populatedPosts,
					pagination: {
						page,
						limit,
						hasMore: offset + limit < scoredPosts.length,
					},
				});
			} catch (error) {
				console.error("Error fetching feed:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get trending posts
		router.get("/trending", async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = Math.min(parseInt(req.query.limit) || 20, 50);
				const skip = (page - 1) * limit;
				const sport = req.query.sport;

				const query = {
					status: "published",
					visibility: "public",
					createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
				};

				if (sport && sport !== "all" && SPORT_TYPES.includes(sport)) {
					query.sportTypes = sport;
				}

				// Sort by engagement metrics
				const posts = await feedCollection
					.find(query)
					.sort({
						"stats.loveCount": -1,
						"stats.respectCount": -1,
						"stats.commentCount": -1,
					})
					.skip(skip)
					.limit(limit)
					.toArray();

				const populatedPosts = await populatePostUsers(posts);

				res.send({
					posts: populatedPosts,
					pagination: { page, limit },
				});
			} catch (error) {
				console.error("Error fetching trending:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get user's posts
		router.get("/user/:userId", async (req, res) => {
			const { userId } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;

			if (!ObjectId.isValid(userId)) {
				return res.status(400).send({ error: "Invalid user ID" });
			}

			try {
				const query = {
					userId: userId,
					status: "published",
				};

				// Only show public posts unless viewing own profile
				let requesterId = null;
				if (req.headers["x-auth-token"]) {
					try {
						const jwt = require("jsonwebtoken");
						const decoded = jwt.verify(
							req.headers["x-auth-token"],
							process.env.JWT_SECRET || "jwtPrivateKey"
						);
						requesterId = decoded.userId;
					} catch (e) {}
				}

				if (requesterId !== userId) {
					query.visibility = "public";
				}

				const [posts, total] = await Promise.all([
					feedCollection
						.find(query)
						.sort({ createdAt: -1 })
						.skip(skip)
						.limit(limit)
						.toArray(),
					feedCollection.countDocuments(query),
				]);

				const populatedPosts = await populatePostUsers(posts);

				res.send({
					posts: populatedPosts,
					pagination: {
						page,
						limit,
						total,
						pages: Math.ceil(total / limit),
					},
				});
			} catch (error) {
				console.error("Error fetching user posts:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get sport-specific feed
		router.get("/sport/:sportType", async (req, res) => {
			const { sportType } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;

			if (!SPORT_TYPES.includes(sportType)) {
				return res.status(400).send({ error: "Invalid sport type" });
			}

			try {
				const query = {
					sportTypes: sportType,
					status: "published",
					visibility: "public",
				};

				const posts = await feedCollection
					.find(query)
					.sort({ createdAt: -1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				const populatedPosts = await populatePostUsers(posts);

				res.send({
					posts: populatedPosts,
					pagination: { page, limit },
				});
			} catch (error) {
				console.error("Error fetching sport feed:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get single post details
		router.get("/:postId", async (req, res) => {
			const { postId } = req.params;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

				if (!post) {
					return res.status(404).send({ error: "Post not found" });
				}

				const populatedPosts = await populatePostUsers([post]);

				res.send(populatedPosts[0]);
			} catch (error) {
				console.error("Error fetching post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// =============================================
		// POST CRUD ENDPOINTS
		// =============================================

		// Create new post
		router.post("/", auth, async (req, res) => {
			const userId = req.user.userId;
			const {
				mediaType,
				bunnyVideoId,
				hlsUrl,
				thumbnailUrl,
				imageUrls,
				caption,
				sportTypes,
				tricks,
				location,
				duration,
				aspectRatio,
				visibility,
			} = req.body;

			if (!mediaType || !["video", "image", "carousel"].includes(mediaType)) {
				return res.status(400).send({ error: "Invalid media type" });
			}

			// Validate video duration (max 3 minutes = 180 seconds)
			if (mediaType === "video" && duration && duration > 180) {
				return res
					.status(400)
					.send({ error: "Video duration exceeds 3 minute limit" });
			}

			try {
				const post = {
					userId: userId,
					mediaType,
					bunnyVideoId: bunnyVideoId || null,
					hlsUrl: hlsUrl || null,
					thumbnailUrl: thumbnailUrl || null,
					imageUrls: imageUrls || [],
					caption: caption || "",
					sportTypes: sportTypes || [],
					tricks: tricks || [],
					location: location || null,
					duration: duration || null,
					aspectRatio: aspectRatio || "9:16",
					stats: {
						loveCount: 0,
						respectCount: 0,
						commentCount: 0,
						shareCount: 0,
						viewCount: 0,
						saveCount: 0,
					},
					engagement: {
						completionRate: 0,
						rewatchRate: 0,
						skipRate: 0,
					},
					visibility: visibility || "public",
					status: hlsUrl || imageUrls?.length > 0 ? "published" : "processing",
					createdAt: new Date(),
					updatedAt: new Date(),
				};

				const result = await feedCollection.insertOne(post);
				post._id = result.insertedId;

				// Populate user data
				const populatedPosts = await populatePostUsers([post]);

				res.status(201).send(populatedPosts[0]);
			} catch (error) {
				console.error("Error creating post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Update post
		router.put("/:postId", auth, async (req, res) => {
			const { postId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

				if (!post) {
					return res.status(404).send({ error: "Post not found" });
				}

				if (post.userId !== userId) {
					return res.status(403).send({ error: "Access denied" });
				}

				// Only allow updating certain fields
				const allowedUpdates = ["caption", "visibility", "sportTypes", "tricks"];
				const updates = { updatedAt: new Date() };

				allowedUpdates.forEach((field) => {
					if (req.body[field] !== undefined) {
						updates[field] = req.body[field];
					}
				});

				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $set: updates }
				);

				const updated = await feedCollection.findOne({
					_id: new ObjectId(postId),
				});
				const populatedPosts = await populatePostUsers([updated]);

				res.send(populatedPosts[0]);
			} catch (error) {
				console.error("Error updating post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Delete post
		router.delete("/:postId", auth, async (req, res) => {
			const { postId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

				if (!post) {
					return res.status(404).send({ error: "Post not found" });
				}

				if (post.userId !== userId) {
					return res.status(403).send({ error: "Access denied" });
				}

				await feedCollection.deleteOne({ _id: new ObjectId(postId) });

				// Also delete related data
				await Promise.all([
					reactionsCollection.deleteMany({ postId: postId }),
					commentsCollection.deleteMany({ postId: postId }),
					savedPostsCollection.deleteMany({ postId: postId }),
				]);

				res.send({ message: "Post deleted" });
			} catch (error) {
				console.error("Error deleting post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// =============================================
		// REACTION ENDPOINTS
		// =============================================

		// Add reaction (love or respect)
		router.post("/:postId/reaction", auth, async (req, res) => {
			const { postId } = req.params;
			const { type } = req.body;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			if (!type || !["love", "respect"].includes(type)) {
				return res.status(400).send({ error: "Invalid reaction type" });
			}

			try {
				// Check if reaction already exists
				const existing = await reactionsCollection.findOne({
					postId: postId,
					userId: userId,
					type: type,
				});

				if (existing) {
					return res.status(400).send({ error: "Already reacted" });
				}

				// Add reaction
				await reactionsCollection.insertOne({
					postId: postId,
					userId: userId,
					type: type,
					createdAt: new Date(),
				});

				// Update post stats
				const statField = type === "love" ? "stats.loveCount" : "stats.respectCount";
				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $inc: { [statField]: 1 } }
				);

				const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

				res.send({
					message: "Reaction added",
					loveCount: post.stats?.loveCount || 0,
					respectCount: post.stats?.respectCount || 0,
				});
			} catch (error) {
				console.error("Error adding reaction:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Remove reaction
		router.delete("/:postId/reaction/:type", auth, async (req, res) => {
			const { postId, type } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			if (!["love", "respect"].includes(type)) {
				return res.status(400).send({ error: "Invalid reaction type" });
			}

			try {
				const result = await reactionsCollection.deleteOne({
					postId: postId,
					userId: userId,
					type: type,
				});

				if (result.deletedCount === 0) {
					return res.status(404).send({ error: "Reaction not found" });
				}

				// Update post stats
				const statField = type === "love" ? "stats.loveCount" : "stats.respectCount";
				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $inc: { [statField]: -1 } }
				);

				const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

				res.send({
					message: "Reaction removed",
					loveCount: post.stats?.loveCount || 0,
					respectCount: post.stats?.respectCount || 0,
				});
			} catch (error) {
				console.error("Error removing reaction:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// =============================================
		// COMMENT ENDPOINTS
		// =============================================

		// Get comments for a post
		router.get("/:postId/comments", async (req, res) => {
			const { postId } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				// Get top-level comments
				const comments = await commentsCollection
					.find({
						postId: postId,
						parentCommentId: null,
						status: "active",
					})
					.sort({ createdAt: -1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				// Populate user data
				const userIds = [...new Set(comments.map((c) => c.userId))];
				const users = await usersCollection
					.find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
					.project({ name: 1, imageUri: 1 })
					.toArray();

				const userMap = {};
				users.forEach((u) => {
					userMap[u._id.toString()] = u;
				});

				const populatedComments = comments.map((comment) => ({
					...comment,
					user: userMap[comment.userId] || { name: "Unknown" },
				}));

				res.send({
					comments: populatedComments,
					pagination: { page, limit },
				});
			} catch (error) {
				console.error("Error fetching comments:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Add comment
		router.post("/:postId/comments", auth, async (req, res) => {
			const { postId } = req.params;
			const { content, parentCommentId } = req.body;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			if (!content || content.trim().length === 0) {
				return res.status(400).send({ error: "Comment cannot be empty" });
			}

			if (content.length > 500) {
				return res.status(400).send({ error: "Comment too long (max 500 chars)" });
			}

			try {
				const comment = {
					postId: postId,
					userId: userId,
					parentCommentId: parentCommentId || null,
					content: content.trim(),
					loveCount: 0,
					replyCount: 0,
					status: "active",
					createdAt: new Date(),
					updatedAt: new Date(),
				};

				const result = await commentsCollection.insertOne(comment);
				comment._id = result.insertedId;

				// Update post comment count
				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $inc: { "stats.commentCount": 1 } }
				);

				// If it's a reply, update parent's reply count
				if (parentCommentId) {
					await commentsCollection.updateOne(
						{ _id: new ObjectId(parentCommentId) },
						{ $inc: { replyCount: 1 } }
					);
				}

				// Get user data
				const user = await usersCollection.findOne(
					{ _id: new ObjectId(userId) },
					{ projection: { name: 1, imageUri: 1 } }
				);

				const populatedComment = {
					...comment,
					user: user || { name: "Unknown" },
				};

				// Emit real-time event
				const io = req.app.get("io");
				if (io) {
					emitNewComment(io, postId, populatedComment);
				}

				res.status(201).send(populatedComment);
			} catch (error) {
				console.error("Error adding comment:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Delete comment
		router.delete("/:postId/comments/:commentId", auth, async (req, res) => {
			const { postId, commentId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const comment = await commentsCollection.findOne({
					_id: new ObjectId(commentId),
				});

				if (!comment) {
					return res.status(404).send({ error: "Comment not found" });
				}

				if (comment.userId !== userId) {
					return res.status(403).send({ error: "Access denied" });
				}

				// Soft delete
				await commentsCollection.updateOne(
					{ _id: new ObjectId(commentId) },
					{ $set: { status: "deleted", updatedAt: new Date() } }
				);

				// Update post comment count
				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $inc: { "stats.commentCount": -1 } }
				);

				// Emit real-time event
				const io = req.app.get("io");
				if (io) {
					emitCommentDeleted(io, postId, commentId);
				}

				res.send({ message: "Comment deleted" });
			} catch (error) {
				console.error("Error deleting comment:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get replies to a comment
		router.get("/:postId/comments/:commentId/replies", async (req, res) => {
			const { postId, commentId } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 10, 50);
			const skip = (page - 1) * limit;

			if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const replies = await commentsCollection
					.find({
						postId: postId,
						parentCommentId: commentId,
						status: "active",
					})
					.sort({ createdAt: 1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				// Populate user data
				const userIds = [...new Set(replies.map((c) => c.userId))];
				const users = await usersCollection
					.find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
					.project({ name: 1, imageUri: 1 })
					.toArray();

				const userMap = {};
				users.forEach((u) => {
					userMap[u._id.toString()] = u;
				});

				const populatedReplies = replies.map((reply) => ({
					...reply,
					user: userMap[reply.userId] || { name: "Unknown" },
				}));

				res.send({
					replies: populatedReplies,
					pagination: { page, limit, hasMore: replies.length === limit },
				});
			} catch (error) {
				console.error("Error fetching replies:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Love a comment
		router.post("/:postId/comments/:commentId/love", auth, async (req, res) => {
			const { postId, commentId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const commentLovesCollection = db.collection("comment_loves");

				// Check if already loved
				const existing = await commentLovesCollection.findOne({
					commentId: commentId,
					userId: userId,
				});

				if (existing) {
					// Unlike
					await commentLovesCollection.deleteOne({ _id: existing._id });
					await commentsCollection.updateOne(
						{ _id: new ObjectId(commentId) },
						{ $inc: { loveCount: -1 } }
					);

					const comment = await commentsCollection.findOne({
						_id: new ObjectId(commentId),
					});

					// Emit real-time event
					const io = req.app.get("io");
					if (io) {
						emitCommentLoved(io, postId, commentId, comment?.loveCount || 0);
					}

					return res.send({ loved: false, loveCount: comment?.loveCount || 0 });
				}

				// Love
				await commentLovesCollection.insertOne({
					commentId: commentId,
					userId: userId,
					createdAt: new Date(),
				});

				await commentsCollection.updateOne(
					{ _id: new ObjectId(commentId) },
					{ $inc: { loveCount: 1 } }
				);

				const comment = await commentsCollection.findOne({
					_id: new ObjectId(commentId),
				});

				// Emit real-time event
				const io = req.app.get("io");
				if (io) {
					emitCommentLoved(io, postId, commentId, comment?.loveCount || 0);
				}

				res.send({ loved: true, loveCount: comment?.loveCount || 0 });
			} catch (error) {
				console.error("Error loving comment:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// =============================================
		// OTHER ENDPOINTS
		// =============================================

		// Save/unsave post
		router.post("/:postId/save", auth, async (req, res) => {
			const { postId } = req.params;
			const { save } = req.body;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				if (save) {
					await savedPostsCollection.updateOne(
						{ postId: postId, userId: userId },
						{
							$set: { postId: postId, userId: userId, savedAt: new Date() },
						},
						{ upsert: true }
					);
					await feedCollection.updateOne(
						{ _id: new ObjectId(postId) },
						{ $inc: { "stats.saveCount": 1 } }
					);
				} else {
					const result = await savedPostsCollection.deleteOne({
						postId: postId,
						userId: userId,
					});
					if (result.deletedCount > 0) {
						await feedCollection.updateOne(
							{ _id: new ObjectId(postId) },
							{ $inc: { "stats.saveCount": -1 } }
						);
					}
				}

				res.send({ message: save ? "Post saved" : "Post unsaved", saved: save });
			} catch (error) {
				console.error("Error saving post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Get saved posts
		router.get("/saved", auth, async (req, res) => {
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;
			const userId = req.user.userId;

			try {
				const savedPosts = await savedPostsCollection
					.find({ userId: userId })
					.sort({ savedAt: -1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				const postIds = savedPosts.map((sp) => new ObjectId(sp.postId));
				const posts = await feedCollection
					.find({ _id: { $in: postIds } })
					.toArray();

				const populatedPosts = await populatePostUsers(posts);

				res.send({
					posts: populatedPosts,
					pagination: { page, limit },
				});
			} catch (error) {
				console.error("Error fetching saved posts:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Track post view (for analytics)
		router.post("/:postId/view", async (req, res) => {
			const { postId } = req.params;
			const { watchDuration, completed } = req.body;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			try {
				// Increment view count
				await feedCollection.updateOne(
					{ _id: new ObjectId(postId) },
					{ $inc: { "stats.viewCount": 1 } }
				);

				// Update engagement metrics if provided
				if (watchDuration !== undefined || completed !== undefined) {
					// This would ideally use a more sophisticated algorithm
					// For now, just increment view count
				}

				res.send({ message: "View tracked" });
			} catch (error) {
				console.error("Error tracking view:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		// Report a post
		router.post("/:postId/report", auth, async (req, res) => {
			const { postId } = req.params;
			const { reason } = req.body;
			const userId = req.user.userId;

			if (!ObjectId.isValid(postId)) {
				return res.status(400).send({ error: "Invalid post ID" });
			}

			if (!reason) {
				return res.status(400).send({ error: "Reason is required" });
			}

			try {
				await db.collection("reports").insertOne({
					postId: postId,
					reportedBy: userId,
					reason: reason,
					status: "pending",
					createdAt: new Date(),
				});

				res.send({ message: "Report submitted" });
			} catch (error) {
				console.error("Error reporting post:", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.log("MongoDB connection error:", error);
	});

module.exports = router;
