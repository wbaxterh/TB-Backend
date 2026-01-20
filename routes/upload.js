/**
 * Upload Routes - Video Upload API
 * Handles video creation and upload to Bunny.net Stream
 */

const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const bunnyStream = require("../services/bunnyStream");

// =============================================
// VIDEO UPLOAD ENDPOINTS
// =============================================

/**
 * POST /api/upload/video/create
 * Create a new video entry and get upload credentials
 * Client will use these credentials to upload directly to Bunny via TUS
 */
router.post("/video/create", auth, async (req, res) => {
	const { title, collectionId } = req.body;

	if (!title) {
		return res.status(400).send({ error: "Title is required" });
	}

	try {
		// Create video entry in Bunny
		const video = await bunnyStream.createVideo(title, collectionId);

		// Generate upload credentials for client-side TUS upload
		const credentials = bunnyStream.generateUploadCredentials(video.videoId);

		res.send({
			videoId: video.videoId,
			uploadCredentials: credentials,
			// CDN URLs (will be valid after processing completes)
			urls: bunnyStream.getVideoUrls(video.videoId),
		});
	} catch (error) {
		console.error("Error creating video:", error);
		res.status(500).send({ error: "Failed to create video" });
	}
});

/**
 * GET /api/upload/video/:videoId/status
 * Check video processing status
 */
router.get("/video/:videoId/status", async (req, res) => {
	const { videoId } = req.params;

	try {
		const status = await bunnyStream.getVideoStatus(videoId);
		res.send(status);
	} catch (error) {
		console.error("Error getting video status:", error);
		res.status(500).send({ error: "Failed to get video status" });
	}
});

/**
 * DELETE /api/upload/video/:videoId
 * Delete a video from Bunny
 */
router.delete("/video/:videoId", auth, async (req, res) => {
	const { videoId } = req.params;

	try {
		await bunnyStream.deleteVideo(videoId);
		res.send({ message: "Video deleted" });
	} catch (error) {
		console.error("Error deleting video:", error);
		res.status(500).send({ error: "Failed to delete video" });
	}
});

/**
 * POST /api/upload/video/:videoId/thumbnail
 * Set thumbnail from a specific time in the video
 */
router.post("/video/:videoId/thumbnail", auth, async (req, res) => {
	const { videoId } = req.params;
	const { thumbnailTime } = req.body;

	if (thumbnailTime === undefined) {
		return res.status(400).send({ error: "thumbnailTime is required" });
	}

	try {
		await bunnyStream.setThumbnailTime(videoId, thumbnailTime);
		res.send({
			message: "Thumbnail updated",
			thumbnailUrl: `https://${bunnyStream.config.cdnHostname}/${videoId}/thumbnail.jpg`,
		});
	} catch (error) {
		console.error("Error setting thumbnail:", error);
		res.status(500).send({ error: "Failed to set thumbnail" });
	}
});

/**
 * GET /api/upload/videos
 * List all videos (admin/debug endpoint)
 */
router.get("/videos", auth, async (req, res) => {
	const page = parseInt(req.query.page) || 1;
	const limit = parseInt(req.query.limit) || 100;

	try {
		const videos = await bunnyStream.listVideos(page, limit);
		res.send(videos);
	} catch (error) {
		console.error("Error listing videos:", error);
		res.status(500).send({ error: "Failed to list videos" });
	}
});

module.exports = router;
