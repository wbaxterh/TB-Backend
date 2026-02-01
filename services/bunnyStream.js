/**
 * Bunny.net Stream Service
 * Handles video upload, transcoding, and delivery
 */

const axios = require("axios");
const crypto = require("crypto");

const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
const BUNNY_LIBRARY_API_KEY = process.env.BUNNY_LIBRARY_API_KEY;
const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME;

// Base API client for Bunny Stream
const bunnyApi = axios.create({
	baseURL: `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}`,
	headers: {
		AccessKey: BUNNY_LIBRARY_API_KEY,
		"Content-Type": "application/json",
	},
});

/**
 * Create a new video entry in Bunny Stream
 * Returns the video ID and upload URL
 */
async function createVideo(title, collectionId = null) {
	try {
		const payload = { title };
		if (collectionId) {
			payload.collectionId = collectionId;
		}

		const response = await bunnyApi.post("/videos", payload);

		return {
			videoId: response.data.guid,
			libraryId: BUNNY_LIBRARY_ID,
			// Direct upload URL for TUS resumable uploads
			tusUploadUrl: `https://video.bunnycdn.com/tusupload`,
		};
	} catch (error) {
		console.error("Error creating Bunny video:", error.response?.data || error.message);
		throw new Error("Failed to create video");
	}
}

/**
 * Generate TUS upload credentials for client-side upload
 * The client will use these to upload directly to Bunny
 *
 * Bunny.net TUS auth requires SHA256 hash of: library_id + api_key + expiration_time + video_id
 */
function generateUploadCredentials(videoId) {
	const expirationTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

	// Generate SHA256 signature
	const signatureString = BUNNY_LIBRARY_ID + BUNNY_LIBRARY_API_KEY + expirationTime + videoId;
	const signature = crypto.createHash("sha256").update(signatureString).digest("hex");

	return {
		videoId,
		libraryId: BUNNY_LIBRARY_ID,
		tusEndpoint: "https://video.bunnycdn.com/tusupload",
		expirationTime,
		// For TUS uploads, the client needs these headers
		headers: {
			AuthorizationSignature: signature,
			AuthorizationExpire: expirationTime,
			VideoId: videoId,
			LibraryId: BUNNY_LIBRARY_ID,
		},
	};
}

/**
 * Get video status and URLs
 */
async function getVideoStatus(videoId) {
	try {
		const response = await bunnyApi.get(`/videos/${videoId}`);
		const video = response.data;

		// Status codes:
		// 0 = Created, 1 = Uploaded, 2 = Processing, 3 = Transcoding, 4 = Finished, 5 = Error
		const statusMap = {
			0: "created",
			1: "uploaded",
			2: "processing",
			3: "transcoding",
			4: "finished",
			5: "error",
			6: "upload_failed",
		};

		return {
			videoId: video.guid,
			status: statusMap[video.status] || "unknown",
			statusCode: video.status,
			isReady: video.status === 4,
			title: video.title,
			duration: video.length, // in seconds
			width: video.width,
			height: video.height,
			// URLs (only valid when status === 4)
			hlsUrl: video.status === 4 ? `https://${BUNNY_CDN_HOSTNAME}/${videoId}/playlist.m3u8` : null,
			thumbnailUrl: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/thumbnail.jpg`,
			previewUrl: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/preview.webp`,
			// Available resolutions after transcoding
			availableResolutions: video.availableResolutions || null,
		};
	} catch (error) {
		console.error("Error getting video status:", error.response?.data || error.message);
		throw new Error("Failed to get video status");
	}
}

/**
 * Delete a video from Bunny Stream
 */
async function deleteVideo(videoId) {
	try {
		await bunnyApi.delete(`/videos/${videoId}`);
		return { success: true };
	} catch (error) {
		console.error("Error deleting video:", error.response?.data || error.message);
		throw new Error("Failed to delete video");
	}
}

/**
 * List all videos in the library
 */
async function listVideos(page = 1, itemsPerPage = 100) {
	try {
		const response = await bunnyApi.get("/videos", {
			params: { page, itemsPerPage },
		});
		return response.data;
	} catch (error) {
		console.error("Error listing videos:", error.response?.data || error.message);
		throw new Error("Failed to list videos");
	}
}

/**
 * Create a collection (for organizing videos)
 */
async function createCollection(name) {
	try {
		const response = await bunnyApi.post("/collections", { name });
		return response.data;
	} catch (error) {
		console.error("Error creating collection:", error.response?.data || error.message);
		throw new Error("Failed to create collection");
	}
}

/**
 * Generate a signed URL for Bunny Stream video playback
 * Required when CDN Token Authentication is enabled in Bunny dashboard
 *
 * Bunny CDN Token Authentication:
 * - Basic: Base64URL(MD5(key + path + expires))
 * - Advanced: Base64URL(SHA256(key + path + expires))
 *
 * Path should include leading slash: /videoId/filename
 */
function generateSignedUrl(videoId, filename, expiresInSeconds = 3600) {
	const securityKey = process.env.BUNNY_STREAM_TOKEN_KEY || BUNNY_LIBRARY_API_KEY;

	if (!securityKey) {
		console.error("ERROR: No security key available for token signing!");
		return `https://${BUNNY_CDN_HOSTNAME}/${videoId}/${filename}`;
	}

	const expiration = Math.floor(Date.now() / 1000) + expiresInSeconds;
	const path = `/${videoId}/${filename}`;

	// Try BASIC (MD5) - this is what many Bunny setups use by default
	const hashMD5 = crypto.createHash("md5").update(securityKey + path + expiration).digest();
	const tokenMD5 = hashMD5.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

	// Also generate SHA256 for comparison
	const hashSHA256 = crypto.createHash("sha256").update(securityKey + path + expiration).digest();
	const tokenSHA256 = hashSHA256.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

	// Use MD5 token (Basic authentication - more commonly used)
	const signedUrl = `https://${BUNNY_CDN_HOSTNAME}${path}?token=${tokenMD5}&expires=${expiration}`;

	// Debug logging
	if (filename === "play_720p.mp4") {
		console.log("=== Bunny Token Generation ===");
		console.log("Key (first 8):", securityKey.substring(0, 8) + "...");
		console.log("Path:", path);
		console.log("Expires:", expiration);
		console.log("MD5 Token:", tokenMD5);
		console.log("SHA256 Token:", tokenSHA256);
		console.log("Using: MD5 (Basic)");
		console.log("URL:", signedUrl);
		console.log("==============================");
	}

	return signedUrl;
}

/**
 * Get CDN URLs for a video
 *
 * Option B (current): signed = false - Uses referrer protection in Bunny dashboard
 * Option A (future): signed = true - Uses token authentication
 */
function getVideoUrls(videoId, signed = false) {
	if (signed) {
		// Return signed URLs (valid for 1 hour) - Option A
		return {
			hlsUrl: generateSignedUrl(videoId, "playlist.m3u8"),
			thumbnailUrl: generateSignedUrl(videoId, "thumbnail.jpg"),
			previewUrl: generateSignedUrl(videoId, "preview.webp"),
			// Individual quality streams
			quality360p: generateSignedUrl(videoId, "play_360p.mp4"),
			quality480p: generateSignedUrl(videoId, "play_480p.mp4"),
			quality720p: generateSignedUrl(videoId, "play_720p.mp4"),
			quality1080p: generateSignedUrl(videoId, "play_1080p.mp4"),
		};
	}

	// Unsigned URLs - Option B (current production setup)
	// Protected via referrer restrictions in Bunny dashboard
	return {
		hlsUrl: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/playlist.m3u8`,
		thumbnailUrl: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/thumbnail.jpg`,
		previewUrl: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/preview.webp`,
		quality360p: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/play_360p.mp4`,
		quality480p: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/play_480p.mp4`,
		quality720p: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/play_720p.mp4`,
		quality1080p: `https://${BUNNY_CDN_HOSTNAME}/${videoId}/play_1080p.mp4`,
	};
}

/**
 * Set video thumbnail from a specific time
 */
async function setThumbnailTime(videoId, thumbnailTime) {
	try {
		const response = await bunnyApi.post(`/videos/${videoId}`, {
			thumbnailTime,
		});
		return response.data;
	} catch (error) {
		console.error("Error setting thumbnail:", error.response?.data || error.message);
		throw new Error("Failed to set thumbnail");
	}
}

module.exports = {
	createVideo,
	generateUploadCredentials,
	getVideoStatus,
	deleteVideo,
	listVideos,
	createCollection,
	getVideoUrls,
	generateSignedUrl,
	setThumbnailTime,
	// Export config for reference
	config: {
		libraryId: BUNNY_LIBRARY_ID,
		cdnHostname: BUNNY_CDN_HOSTNAME,
	},
};
