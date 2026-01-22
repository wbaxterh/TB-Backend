const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { google } = require("googleapis");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");

// Initialize Google Drive API
const credentials = require(path.resolve(process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || "./config/google-drive-credentials.json"));
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const authClient = new google.auth.GoogleAuth({
	credentials,
	scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth: authClient });

// Video file extensions to look for
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

MongoClient.connect(process.env.ATLAS_URI, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const videosCollection = db.collection("couch_videos");
		const collectionsCollection = db.collection("couch_collections");
		const reactionsCollection = db.collection("couch_reactions");
		const commentsCollection = db.collection("couch_comments");
		const requestsCollection = db.collection("couch_requests");

		// ============================================
		// PUBLIC ROUTES
		// ============================================

		// Get all videos (with optional filters)
		router.get("/videos", async (req, res) => {
			try {
				const { sport, collection, sort = "createdAt", limit = 50 } = req.query;
				const query = { isPublished: true };

				if (sport && sport !== "all") {
					query.sportTypes = sport;
				}
				if (collection) {
					query.collectionId = collection;
				}

				const sortOptions = {};
				if (sort === "title") sortOptions.title = 1;
				else if (sort === "releaseYear") sortOptions.releaseYear = -1;
				else if (sort === "popular") sortOptions.viewCount = -1;
				else sortOptions.createdAt = -1;

				const videos = await videosCollection
					.find(query)
					.sort(sortOptions)
					.limit(parseInt(limit))
					.toArray();

				res.send(videos);
			} catch (error) {
				console.error("Error fetching videos:", error);
				res.status(500).send({ error: "Failed to fetch videos" });
			}
		});

		// Get featured video
		router.get("/featured", async (req, res) => {
			try {
				const featured = await videosCollection.findOne({
					isPublished: true,
					isFeatured: true,
				});
				res.send(featured);
			} catch (error) {
				console.error("Error fetching featured:", error);
				res.status(500).send({ error: "Failed to fetch featured video" });
			}
		});

		// Get single video details
		router.get("/videos/:id", async (req, res) => {
			try {
				const { id } = req.params;
				const video = await videosCollection.findOne({
					_id: new ObjectId(id),
					isPublished: true,
				});

				if (!video) {
					return res.status(404).send({ error: "Video not found" });
				}

				// Increment view count
				await videosCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $inc: { viewCount: 1 } }
				);

				// Get reaction counts
				const [loveCount, respectCount] = await Promise.all([
					reactionsCollection.countDocuments({ videoId: id, type: "love" }),
					reactionsCollection.countDocuments({ videoId: id, type: "respect" }),
				]);

				// Get comment count
				const commentCount = await commentsCollection.countDocuments({
					videoId: id,
					isDeleted: { $ne: true },
				});

				res.send({
					...video,
					stats: {
						loveCount,
						respectCount,
						commentCount,
						viewCount: (video.viewCount || 0) + 1,
					},
				});
			} catch (error) {
				console.error("Error fetching video:", error);
				res.status(500).send({ error: "Failed to fetch video" });
			}
		});

		// Get video stream URL (generates a temporary streaming link)
		router.get("/videos/:id/stream", async (req, res) => {
			try {
				const { id } = req.params;
				const video = await videosCollection.findOne({
					_id: new ObjectId(id),
					isPublished: true,
				});

				if (!video || !video.driveFileId) {
					return res.status(404).send({ error: "Video not found" });
				}

				// Get file metadata and generate streaming URL
				const file = await drive.files.get({
					fileId: video.driveFileId,
					fields: "webContentLink,webViewLink",
				});

				// Return the direct download link (works for streaming)
				res.send({
					streamUrl: `https://drive.google.com/uc?export=download&id=${video.driveFileId}`,
					embedUrl: `https://drive.google.com/file/d/${video.driveFileId}/preview`,
				});
			} catch (error) {
				console.error("Error getting stream URL:", error);
				res.status(500).send({ error: "Failed to get stream URL" });
			}
		});

		// Get all collections
		router.get("/collections", async (req, res) => {
			try {
				const { sport } = req.query;
				const query = { isPublished: true };

				if (sport && sport !== "all") {
					query.sportTypes = sport;
				}

				const collections = await collectionsCollection
					.find(query)
					.sort({ order: 1, name: 1 })
					.toArray();

				// Populate videos for each collection
				for (const collection of collections) {
					collection.videos = await videosCollection
						.find({
							collectionId: collection._id.toString(),
							isPublished: true,
						})
						.sort({ order: 1 })
						.limit(10)
						.toArray();
				}

				res.send(collections);
			} catch (error) {
				console.error("Error fetching collections:", error);
				res.status(500).send({ error: "Failed to fetch collections" });
			}
		});

		// Get single collection with all videos
		router.get("/collections/:id", async (req, res) => {
			try {
				const { id } = req.params;
				const collection = await collectionsCollection.findOne({
					_id: new ObjectId(id),
				});

				if (!collection) {
					return res.status(404).send({ error: "Collection not found" });
				}

				collection.videos = await videosCollection
					.find({
						collectionId: id,
						isPublished: true,
					})
					.sort({ order: 1 })
					.toArray();

				res.send(collection);
			} catch (error) {
				console.error("Error fetching collection:", error);
				res.status(500).send({ error: "Failed to fetch collection" });
			}
		});

		// ============================================
		// REACTIONS (Authenticated)
		// ============================================

		// Get user's reaction on a video
		router.get("/videos/:id/reaction", auth, async (req, res) => {
			try {
				const { id } = req.params;
				const userId = req.user.userId;

				const reactions = await reactionsCollection
					.find({ videoId: id, userId })
					.toArray();

				const userReactions = {
					love: reactions.some((r) => r.type === "love"),
					respect: reactions.some((r) => r.type === "respect"),
				};

				res.send(userReactions);
			} catch (error) {
				console.error("Error fetching reaction:", error);
				res.status(500).send({ error: "Failed to fetch reaction" });
			}
		});

		// Add reaction
		router.post("/videos/:id/reaction", auth, async (req, res) => {
			try {
				const { id } = req.params;
				const { type } = req.body;
				const userId = req.user.userId;

				if (!["love", "respect"].includes(type)) {
					return res.status(400).send({ error: "Invalid reaction type" });
				}

				// Check if already reacted
				const existing = await reactionsCollection.findOne({
					videoId: id,
					userId,
					type,
				});

				if (existing) {
					return res.status(400).send({ error: "Already reacted" });
				}

				await reactionsCollection.insertOne({
					videoId: id,
					userId,
					type,
					createdAt: new Date(),
				});

				res.send({ success: true });
			} catch (error) {
				console.error("Error adding reaction:", error);
				res.status(500).send({ error: "Failed to add reaction" });
			}
		});

		// Remove reaction
		router.delete("/videos/:id/reaction/:type", auth, async (req, res) => {
			try {
				const { id, type } = req.params;
				const userId = req.user.userId;

				await reactionsCollection.deleteOne({
					videoId: id,
					userId,
					type,
				});

				res.send({ success: true });
			} catch (error) {
				console.error("Error removing reaction:", error);
				res.status(500).send({ error: "Failed to remove reaction" });
			}
		});

		// ============================================
		// COMMENTS (Authenticated)
		// ============================================

		// Get comments for a video
		router.get("/videos/:id/comments", async (req, res) => {
			try {
				const { id } = req.params;
				const { page = 1, limit = 20 } = req.query;
				const skip = (parseInt(page) - 1) * parseInt(limit);

				const comments = await commentsCollection
					.aggregate([
						{
							$match: {
								videoId: id,
								isDeleted: { $ne: true },
								parentCommentId: { $exists: false },
							},
						},
						{ $sort: { createdAt: -1 } },
						{ $skip: skip },
						{ $limit: parseInt(limit) },
						{
							$lookup: {
								from: "users",
								let: { odId: { $toObjectId: "$userId" } },
								pipeline: [
									{ $match: { $expr: { $eq: ["$_id", "$$odId"] } } },
									{ $project: { name: 1, imageUri: 1 } },
								],
								as: "user",
							},
						},
						{ $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
					])
					.toArray();

				const total = await commentsCollection.countDocuments({
					videoId: id,
					isDeleted: { $ne: true },
					parentCommentId: { $exists: false },
				});

				res.send({
					comments,
					pagination: {
						page: parseInt(page),
						limit: parseInt(limit),
						total,
						hasMore: skip + comments.length < total,
					},
				});
			} catch (error) {
				console.error("Error fetching comments:", error);
				res.status(500).send({ error: "Failed to fetch comments" });
			}
		});

		// Add comment
		router.post("/videos/:id/comments", auth, async (req, res) => {
			try {
				const { id } = req.params;
				const { content, parentCommentId } = req.body;
				const userId = req.user.userId;

				if (!content || !content.trim()) {
					return res.status(400).send({ error: "Comment content required" });
				}

				const comment = {
					videoId: id,
					userId,
					content: content.trim(),
					parentCommentId: parentCommentId || null,
					createdAt: new Date(),
				};

				const result = await commentsCollection.insertOne(comment);
				comment._id = result.insertedId;

				res.status(201).send(comment);
			} catch (error) {
				console.error("Error adding comment:", error);
				res.status(500).send({ error: "Failed to add comment" });
			}
		});

		// Delete comment (soft delete)
		router.delete("/videos/:videoId/comments/:commentId", auth, async (req, res) => {
			try {
				const { videoId, commentId } = req.params;
				const userId = req.user.userId;

				const comment = await commentsCollection.findOne({
					_id: new ObjectId(commentId),
				});

				if (!comment) {
					return res.status(404).send({ error: "Comment not found" });
				}

				// Only allow owner or admin to delete
				if (comment.userId !== userId && req.user.role !== "admin") {
					return res.status(403).send({ error: "Not authorized" });
				}

				await commentsCollection.updateOne(
					{ _id: new ObjectId(commentId) },
					{ $set: { isDeleted: true, deletedAt: new Date() } }
				);

				res.send({ success: true });
			} catch (error) {
				console.error("Error deleting comment:", error);
				res.status(500).send({ error: "Failed to delete comment" });
			}
		});

		// ============================================
		// VIDEO REQUESTS (Authenticated)
		// ============================================

		// Submit a video request
		router.post("/requests", auth, async (req, res) => {
			try {
				const { title, description, link } = req.body;
				const userId = req.user.userId;

				if (!title) {
					return res.status(400).send({ error: "Title required" });
				}

				const request = {
					userId,
					title,
					description: description || "",
					link: link || "",
					status: "pending",
					createdAt: new Date(),
				};

				const result = await requestsCollection.insertOne(request);
				request._id = result.insertedId;

				res.status(201).send(request);
			} catch (error) {
				console.error("Error submitting request:", error);
				res.status(500).send({ error: "Failed to submit request" });
			}
		});

		// Get user's requests
		router.get("/requests/mine", auth, async (req, res) => {
			try {
				const userId = req.user.userId;
				const requests = await requestsCollection
					.find({ userId })
					.sort({ createdAt: -1 })
					.toArray();

				res.send(requests);
			} catch (error) {
				console.error("Error fetching requests:", error);
				res.status(500).send({ error: "Failed to fetch requests" });
			}
		});

		// ============================================
		// ADMIN ROUTES
		// ============================================

		// Sync videos from Google Drive folder
		router.post("/admin/sync", auth, async (req, res) => {
			try {
				// Check if admin
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				console.log("Starting Google Drive sync...");
				console.log("Folder ID:", FOLDER_ID);

				// List all video files in the folder
				const response = await drive.files.list({
					q: `'${FOLDER_ID}' in parents and trashed = false`,
					fields: "files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink)",
					pageSize: 100,
				});

				const files = response.data.files || [];
				console.log(`Found ${files.length} files in Drive folder`);

				const videoFiles = files.filter((file) => {
					const ext = path.extname(file.name).toLowerCase();
					return VIDEO_EXTENSIONS.includes(ext) || file.mimeType.startsWith("video/");
				});

				console.log(`Found ${videoFiles.length} video files`);

				let added = 0;
				let updated = 0;

				for (const file of videoFiles) {
					const existing = await videosCollection.findOne({
						driveFileId: file.id,
					});

					const videoData = {
						driveFileId: file.id,
						driveFileName: file.name,
						title: path.basename(file.name, path.extname(file.name)),
						mimeType: file.mimeType,
						size: parseInt(file.size) || 0,
						driveThumbnail: file.thumbnailLink,
						driveViewLink: file.webViewLink,
						driveModifiedTime: file.modifiedTime,
						updatedAt: new Date(),
					};

					if (existing) {
						await videosCollection.updateOne(
							{ _id: existing._id },
							{ $set: videoData }
						);
						updated++;
					} else {
						await videosCollection.insertOne({
							...videoData,
							description: "",
							sportTypes: [],
							releaseYear: null,
							thumbnails: {},
							isPublished: false, // Admin must publish manually
							isFeatured: false,
							viewCount: 0,
							collectionId: null,
							order: 0,
							createdAt: new Date(),
						});
						added++;
					}
				}

				res.send({
					success: true,
					message: `Sync complete. Added: ${added}, Updated: ${updated}`,
					totalFiles: files.length,
					videoFiles: videoFiles.length,
				});
			} catch (error) {
				console.error("Error syncing from Drive:", error);
				res.status(500).send({ error: "Failed to sync: " + error.message });
			}
		});

		// Get all videos (admin - includes unpublished)
		router.get("/admin/videos", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const videos = await videosCollection
					.find({})
					.sort({ createdAt: -1 })
					.toArray();

				res.send(videos);
			} catch (error) {
				console.error("Error fetching admin videos:", error);
				res.status(500).send({ error: "Failed to fetch videos" });
			}
		});

		// Update video metadata (admin)
		router.put("/admin/videos/:id", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const { id } = req.params;
				const {
					title,
					description,
					sportTypes,
					releaseYear,
					thumbnails,
					isPublished,
					isFeatured,
					collectionId,
					order,
				} = req.body;

				const updateData = { updatedAt: new Date() };

				if (title !== undefined) updateData.title = title;
				if (description !== undefined) updateData.description = description;
				if (sportTypes !== undefined) updateData.sportTypes = sportTypes;
				if (releaseYear !== undefined) updateData.releaseYear = releaseYear;
				if (thumbnails !== undefined) updateData.thumbnails = thumbnails;
				if (isPublished !== undefined) updateData.isPublished = isPublished;
				if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
				if (collectionId !== undefined) updateData.collectionId = collectionId;
				if (order !== undefined) updateData.order = order;

				await videosCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $set: updateData }
				);

				const updated = await videosCollection.findOne({ _id: new ObjectId(id) });
				res.send(updated);
			} catch (error) {
				console.error("Error updating video:", error);
				res.status(500).send({ error: "Failed to update video" });
			}
		});

		// Delete video (admin)
		router.delete("/admin/videos/:id", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const { id } = req.params;
				await videosCollection.deleteOne({ _id: new ObjectId(id) });
				res.send({ success: true });
			} catch (error) {
				console.error("Error deleting video:", error);
				res.status(500).send({ error: "Failed to delete video" });
			}
		});

		// Create collection (admin)
		router.post("/admin/collections", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const { name, description, sportTypes, order } = req.body;

				if (!name) {
					return res.status(400).send({ error: "Name required" });
				}

				const collection = {
					name,
					description: description || "",
					sportTypes: sportTypes || [],
					isPublished: true,
					order: order || 0,
					createdAt: new Date(),
				};

				const result = await collectionsCollection.insertOne(collection);
				collection._id = result.insertedId;

				res.status(201).send(collection);
			} catch (error) {
				console.error("Error creating collection:", error);
				res.status(500).send({ error: "Failed to create collection" });
			}
		});

		// Update collection (admin)
		router.put("/admin/collections/:id", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const { id } = req.params;
				const { name, description, sportTypes, isPublished, order } = req.body;

				const updateData = { updatedAt: new Date() };
				if (name !== undefined) updateData.name = name;
				if (description !== undefined) updateData.description = description;
				if (sportTypes !== undefined) updateData.sportTypes = sportTypes;
				if (isPublished !== undefined) updateData.isPublished = isPublished;
				if (order !== undefined) updateData.order = order;

				await collectionsCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $set: updateData }
				);

				const updated = await collectionsCollection.findOne({ _id: new ObjectId(id) });
				res.send(updated);
			} catch (error) {
				console.error("Error updating collection:", error);
				res.status(500).send({ error: "Failed to update collection" });
			}
		});

		// Get all requests (admin)
		router.get("/admin/requests", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const requests = await requestsCollection
					.aggregate([
						{ $sort: { createdAt: -1 } },
						{
							$lookup: {
								from: "users",
								let: { odId: { $toObjectId: "$userId" } },
								pipeline: [
									{ $match: { $expr: { $eq: ["$_id", "$$odId"] } } },
									{ $project: { name: 1, email: 1 } },
								],
								as: "user",
							},
						},
						{ $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
					])
					.toArray();

				res.send(requests);
			} catch (error) {
				console.error("Error fetching requests:", error);
				res.status(500).send({ error: "Failed to fetch requests" });
			}
		});

		// Update request status (admin)
		router.put("/admin/requests/:id", auth, async (req, res) => {
			try {
				if (req.user.role !== "admin") {
					return res.status(403).send({ error: "Admin access required" });
				}

				const { id } = req.params;
				const { status } = req.body;

				if (!["pending", "approved", "rejected", "fulfilled"].includes(status)) {
					return res.status(400).send({ error: "Invalid status" });
				}

				await requestsCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $set: { status, updatedAt: new Date() } }
				);

				res.send({ success: true });
			} catch (error) {
				console.error("Error updating request:", error);
				res.status(500).send({ error: "Failed to update request" });
			}
		});
	})
	.catch((error) => {
		console.error("Failed to connect to MongoDB for Couch routes:", error);
	});

module.exports = router;
