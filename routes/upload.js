/**
 * Upload Routes - Video & Image Upload API
 * Handles video upload to Bunny.net Stream and images to S3
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bunnyStream = require('../services/bunnyStream');
const s3Upload = require('../services/s3Upload');

// =============================================
// VIDEO UPLOAD ENDPOINTS
// =============================================

/**
 * POST /api/upload/video/create
 * Create a new video entry and get upload credentials
 * Client will use these credentials to upload directly to Bunny via TUS
 */
router.post('/video/create', auth, async (req, res) => {
  const { title, collectionId } = req.body;

  if (!title) {
    return res.status(400).send({ error: 'Title is required' });
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
    console.error('Error creating video:', error);
    res.status(500).send({ error: 'Failed to create video' });
  }
});

/**
 * GET /api/upload/video/:videoId/status
 * Check video processing status
 */
router.get('/video/:videoId/status', async (req, res) => {
  const { videoId } = req.params;

  try {
    const status = await bunnyStream.getVideoStatus(videoId);
    res.send(status);
  } catch (error) {
    console.error('Error getting video status:', error);
    res.status(500).send({ error: 'Failed to get video status' });
  }
});

/**
 * DELETE /api/upload/video/:videoId
 * Delete a video from Bunny
 */
router.delete('/video/:videoId', auth, async (req, res) => {
  const { videoId } = req.params;

  try {
    await bunnyStream.deleteVideo(videoId);
    res.send({ message: 'Video deleted' });
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).send({ error: 'Failed to delete video' });
  }
});

/**
 * POST /api/upload/video/:videoId/thumbnail
 * Set thumbnail from a specific time in the video
 */
router.post('/video/:videoId/thumbnail', auth, async (req, res) => {
  const { videoId } = req.params;
  const { thumbnailTime } = req.body;

  if (thumbnailTime === undefined) {
    return res.status(400).send({ error: 'thumbnailTime is required' });
  }

  try {
    await bunnyStream.setThumbnailTime(videoId, thumbnailTime);
    res.send({
      message: 'Thumbnail updated',
      thumbnailUrl: `https://${bunnyStream.config.cdnHostname}/${videoId}/thumbnail.jpg`,
    });
  } catch (error) {
    console.error('Error setting thumbnail:', error);
    res.status(500).send({ error: 'Failed to set thumbnail' });
  }
});

/**
 * GET /api/upload/videos
 * List all videos (admin/debug endpoint)
 */
router.get('/videos', auth, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 100;

  try {
    const videos = await bunnyStream.listVideos(page, limit);
    res.send(videos);
  } catch (error) {
    console.error('Error listing videos:', error);
    res.status(500).send({ error: 'Failed to list videos' });
  }
});

// =============================================
// IMAGE UPLOAD ENDPOINTS
// =============================================

/**
 * POST /api/upload/image/presign
 * Get a presigned URL for direct client-side upload to S3
 */
router.post('/image/presign', auth, async (req, res) => {
  const { filename, contentType } = req.body;

  if (!filename) {
    return res.status(400).send({ error: 'Filename is required' });
  }

  // Validate content type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const type = contentType || 'image/jpeg';

  if (!allowedTypes.includes(type)) {
    return res.status(400).send({ error: 'Invalid image type. Allowed: jpg, png, webp, gif' });
  }

  try {
    const result = await s3Upload.getPresignedUploadUrl(filename, type);
    res.send(result);
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).send({ error: 'Failed to generate upload URL' });
  }
});

/**
 * POST /api/upload/image/base64
 * Upload a base64 encoded image directly
 */
router.post('/image/base64', auth, async (req, res) => {
  const { image, filename } = req.body;

  if (!image) {
    return res.status(400).send({ error: 'Image data is required' });
  }

  // Check base64 size (rough limit of 10MB)
  if (image.length > 10 * 1024 * 1024 * 1.37) {
    // Base64 is ~37% larger
    return res.status(400).send({ error: 'Image too large. Max 10MB' });
  }

  try {
    const result = await s3Upload.uploadBase64Image(image, filename || `image-${Date.now()}.jpg`);
    res.send(result);
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).send({ error: 'Failed to upload image' });
  }
});

/**
 * DELETE /api/upload/image
 * Delete an image from S3
 */
router.delete('/image', auth, async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).send({ error: 'Image key is required' });
  }

  // Ensure key is in feed folder (security)
  if (!key.startsWith('feed/')) {
    return res.status(403).send({ error: 'Cannot delete this resource' });
  }

  try {
    await s3Upload.deleteFile(key);
    res.send({ message: 'Image deleted' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).send({ error: 'Failed to delete image' });
  }
});

module.exports = router;
