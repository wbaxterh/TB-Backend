/**
 * Spot Reviews Route
 * Handles CRUD operations for spot reviews and ratings
 */

const express = require("express");
const router = express.Router();
const Joi = require("joi");
const auth = require("../middleware/auth");
const { MongoClient, ObjectId } = require("mongodb");

const connectionString = process.env.ATLAS_URI;

// Validation schemas
const createReviewSchema = Joi.object({
	spotId: Joi.string().required(),
	rating: Joi.number().min(1).max(5).required(),
	content: Joi.string().max(1000).allow("").optional(),
	visitDate: Joi.date().optional(),
	tags: Joi.array().items(Joi.string()).optional(),
});

const updateReviewSchema = Joi.object({
	rating: Joi.number().min(1).max(5).optional(),
	content: Joi.string().max(1000).allow("").optional(),
	visitDate: Joi.date().optional(),
	tags: Joi.array().items(Joi.string()).optional(),
});

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const reviewsCollection = db.collection("spot_reviews");
		const spotsCollection = db.collection("spots");
		const usersCollection = db.collection("users");
		const helpfulCollection = db.collection("review_helpful");

		/**
		 * Helper: Recalculate and update spot rating
		 */
		const updateSpotRating = async (spotId) => {
			const reviews = await reviewsCollection
				.find({ spotId: spotId, status: "active" })
				.toArray();

			if (reviews.length === 0) {
				await spotsCollection.updateOne(
					{ _id: new ObjectId(spotId) },
					{ $set: { rating: null, reviewCount: 0 } }
				);
				return;
			}

			const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

			await spotsCollection.updateOne(
				{ _id: new ObjectId(spotId) },
				{
					$set: {
						rating: Math.round(avgRating * 10) / 10, // Round to 1 decimal
						reviewCount: reviews.length,
					},
				}
			);
		};

		/**
		 * Helper: Populate user data for reviews
		 */
		const populateUsers = async (reviews) => {
			const userIds = [...new Set(reviews.map((r) => r.userId))];
			const users = await usersCollection
				.find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
				.project({ name: 1, imageUri: 1 })
				.toArray();

			const userMap = {};
			users.forEach((u) => {
				userMap[u._id.toString()] = u;
			});

			return reviews.map((review) => ({
				...review,
				user: userMap[review.userId] || { name: "Anonymous" },
			}));
		};

		/**
		 * GET /api/spot-reviews/:spotId
		 * Get reviews for a spot with pagination and rating distribution
		 */
		router.get("/:spotId", async (req, res) => {
			const { spotId } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;
			const sort = req.query.sort || "createdAt";

			if (!ObjectId.isValid(spotId)) {
				return res.status(400).json({ error: "Invalid spot ID" });
			}

			try {
				// Build sort options
				const sortOptions = {};
				if (sort === "rating") sortOptions.rating = -1;
				else if (sort === "helpful") sortOptions.helpfulCount = -1;
				else if (sort === "oldest") sortOptions.createdAt = 1;
				else sortOptions.createdAt = -1;

				// Fetch reviews and count in parallel
				const [reviews, total] = await Promise.all([
					reviewsCollection
						.find({ spotId: spotId, status: "active" })
						.sort(sortOptions)
						.skip(skip)
						.limit(limit)
						.toArray(),
					reviewsCollection.countDocuments({ spotId: spotId, status: "active" }),
				]);

				// Populate user data
				const populatedReviews = await populateUsers(reviews);

				// Calculate rating distribution
				const distribution = await reviewsCollection
					.aggregate([
						{ $match: { spotId: spotId, status: "active" } },
						{ $group: { _id: "$rating", count: { $sum: 1 } } },
					])
					.toArray();

				const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
				distribution.forEach((d) => {
					ratingDistribution[d._id] = d.count;
				});

				res.json({
					reviews: populatedReviews,
					ratingDistribution,
					pagination: {
						page,
						limit,
						total,
						pages: Math.ceil(total / limit),
						hasMore: page * limit < total,
					},
				});
			} catch (error) {
				console.error("Error fetching reviews:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		/**
		 * POST /api/spot-reviews
		 * Create a new review (requires authentication)
		 */
		router.post("/", auth, async (req, res) => {
			const { spotId, rating, content, visitDate, tags } = req.body;
			const userId = req.user.userId;

			// Validate request body
			const { error } = createReviewSchema.validate(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			if (!ObjectId.isValid(spotId)) {
				return res.status(400).json({ error: "Invalid spot ID" });
			}

			try {
				// Check if spot exists
				const spot = await spotsCollection.findOne({ _id: new ObjectId(spotId) });
				if (!spot) {
					return res.status(404).json({ error: "Spot not found" });
				}

				// Check if user already reviewed this spot
				const existingReview = await reviewsCollection.findOne({
					spotId: spotId,
					userId: userId,
					status: "active",
				});

				if (existingReview) {
					return res.status(400).json({
						error: "You have already reviewed this spot. Edit your existing review instead.",
					});
				}

				// Create the review
				const review = {
					spotId: spotId,
					userId: userId,
					rating: rating,
					content: content || "",
					visitDate: visitDate ? new Date(visitDate) : null,
					tags: tags || [],
					helpfulCount: 0,
					status: "active",
					createdAt: new Date(),
					updatedAt: new Date(),
				};

				const result = await reviewsCollection.insertOne(review);
				review._id = result.insertedId;

				// Update spot's aggregated rating
				await updateSpotRating(spotId);

				// Get user info for response
				const user = await usersCollection.findOne(
					{ _id: new ObjectId(userId) },
					{ projection: { name: 1, imageUri: 1 } }
				);

				console.log(`[SpotReviews] User ${userId} reviewed spot ${spotId} with ${rating} stars`);

				res.status(201).json({
					...review,
					user: user || { name: "Anonymous" },
				});
			} catch (error) {
				console.error("Error creating review:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		/**
		 * PUT /api/spot-reviews/:reviewId
		 * Update own review
		 */
		router.put("/:reviewId", auth, async (req, res) => {
			const { reviewId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(reviewId)) {
				return res.status(400).json({ error: "Invalid review ID" });
			}

			const { error } = updateReviewSchema.validate(req.body);
			if (error) {
				return res.status(400).json({ error: error.details[0].message });
			}

			try {
				const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });

				if (!review) {
					return res.status(404).json({ error: "Review not found" });
				}

				if (review.userId !== userId) {
					return res.status(403).json({ error: "Not authorized to edit this review" });
				}

				// Build update object
				const updateFields = { updatedAt: new Date() };
				if (req.body.rating !== undefined) updateFields.rating = req.body.rating;
				if (req.body.content !== undefined) updateFields.content = req.body.content;
				if (req.body.visitDate !== undefined) updateFields.visitDate = new Date(req.body.visitDate);
				if (req.body.tags !== undefined) updateFields.tags = req.body.tags;

				await reviewsCollection.updateOne(
					{ _id: new ObjectId(reviewId) },
					{ $set: updateFields }
				);

				// Update spot rating if rating changed
				if (updateFields.rating !== undefined) {
					await updateSpotRating(review.spotId);
				}

				const updated = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });
				const populatedReviews = await populateUsers([updated]);

				res.json(populatedReviews[0]);
			} catch (error) {
				console.error("Error updating review:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		/**
		 * DELETE /api/spot-reviews/:reviewId
		 * Soft delete a review
		 */
		router.delete("/:reviewId", auth, async (req, res) => {
			const { reviewId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(reviewId)) {
				return res.status(400).json({ error: "Invalid review ID" });
			}

			try {
				const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });

				if (!review) {
					return res.status(404).json({ error: "Review not found" });
				}

				// Allow deletion by owner or admin
				if (review.userId !== userId && req.user.role !== "admin") {
					return res.status(403).json({ error: "Not authorized to delete this review" });
				}

				// Soft delete
				await reviewsCollection.updateOne(
					{ _id: new ObjectId(reviewId) },
					{
						$set: {
							status: "deleted",
							deletedAt: new Date(),
							deletedBy: userId,
						},
					}
				);

				// Update spot rating
				await updateSpotRating(review.spotId);

				console.log(`[SpotReviews] Review ${reviewId} deleted by ${userId}`);

				res.json({ message: "Review deleted successfully" });
			} catch (error) {
				console.error("Error deleting review:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		/**
		 * POST /api/spot-reviews/:reviewId/helpful
		 * Toggle helpful mark on a review
		 */
		router.post("/:reviewId/helpful", auth, async (req, res) => {
			const { reviewId } = req.params;
			const userId = req.user.userId;

			if (!ObjectId.isValid(reviewId)) {
				return res.status(400).json({ error: "Invalid review ID" });
			}

			try {
				// Check if review exists
				const review = await reviewsCollection.findOne({
					_id: new ObjectId(reviewId),
					status: "active",
				});

				if (!review) {
					return res.status(404).json({ error: "Review not found" });
				}

				// Check if already marked helpful
				const existing = await helpfulCollection.findOne({
					reviewId: reviewId,
					userId: userId,
				});

				if (existing) {
					// Remove helpful mark
					await helpfulCollection.deleteOne({ _id: existing._id });
					await reviewsCollection.updateOne(
						{ _id: new ObjectId(reviewId) },
						{ $inc: { helpfulCount: -1 } }
					);
					return res.json({ helpful: false, helpfulCount: review.helpfulCount - 1 });
				}

				// Add helpful mark
				await helpfulCollection.insertOne({
					reviewId: reviewId,
					userId: userId,
					createdAt: new Date(),
				});

				await reviewsCollection.updateOne(
					{ _id: new ObjectId(reviewId) },
					{ $inc: { helpfulCount: 1 } }
				);

				res.json({ helpful: true, helpfulCount: review.helpfulCount + 1 });
			} catch (error) {
				console.error("Error marking helpful:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		/**
		 * GET /api/spot-reviews/user/:userId
		 * Get all reviews by a specific user
		 */
		router.get("/user/:userId", async (req, res) => {
			const { userId } = req.params;
			const page = parseInt(req.query.page) || 1;
			const limit = Math.min(parseInt(req.query.limit) || 20, 50);
			const skip = (page - 1) * limit;

			try {
				const [reviews, total] = await Promise.all([
					reviewsCollection
						.find({ userId: userId, status: "active" })
						.sort({ createdAt: -1 })
						.skip(skip)
						.limit(limit)
						.toArray(),
					reviewsCollection.countDocuments({ userId: userId, status: "active" }),
				]);

				// Get spot info for each review
				const spotIds = reviews.map((r) => new ObjectId(r.spotId));
				const spots = await spotsCollection
					.find({ _id: { $in: spotIds } })
					.project({ name: 1, city: 1, state: 1, imageURL: 1 })
					.toArray();

				const spotMap = {};
				spots.forEach((s) => {
					spotMap[s._id.toString()] = s;
				});

				const reviewsWithSpots = reviews.map((r) => ({
					...r,
					spot: spotMap[r.spotId] || { name: "Unknown Spot" },
				}));

				res.json({
					reviews: reviewsWithSpots,
					pagination: {
						page,
						limit,
						total,
						pages: Math.ceil(total / limit),
						hasMore: page * limit < total,
					},
				});
			} catch (error) {
				console.error("Error fetching user reviews:", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.error("MongoDB connection error for spot reviews:", error);
	});

module.exports = router;
