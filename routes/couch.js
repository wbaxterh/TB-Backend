const express = require('express');
const auth = require('../middleware/auth');
const { google } = require('googleapis');
const { ObjectId } = require('mongodb');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
}); // 5GB limit

// Bunny.net Stream configuration
const _BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
const BUNNY_LIBRARY_API_KEY = process.env.BUNNY_LIBRARY_API_KEY;
const BUNNY_CDN_HOSTNAME = process.env.BUNNY_CDN_HOSTNAME;

// Import Bunny Stream service for signed URLs
const { getVideoUrls } = require('../services/bunnyStream');

// Initialize Google Drive API
const credentials = require(
  path.resolve(
    process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || './config/google-drive-credentials.json',
  ),
);
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const authClient = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth: authClient });

// Video file extensions to look for
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

module.exports = (db) => {
  const router = express.Router();
  const videosCollection = db.collection('couch_videos');
  const collectionsCollection = db.collection('couch_collections');
  const reactionsCollection = db.collection('couch_reactions');
  const commentsCollection = db.collection('couch_comments');
  const requestsCollection = db.collection('couch_requests');

  const publicFilmProjection = {
    bunnyVideoId: 0,
    hlsUrl: 0,
    driveFileId: 0,
  };

  const videoIdentityQuery = (identifier) => {
    if (ObjectId.isValid(identifier)) {
      return { $or: [{ _id: new ObjectId(identifier) }, { slug: identifier }] };
    }
    return { slug: identifier };
  };

  // ============================================
  // PUBLIC ROUTES
  // ============================================

  // SEO/agent-friendly film catalog. Unlike /videos, this supports external-only
  // films, pagination, stable slugs, and fields describing provenance/rights.
  router.get('/films', async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
      const query = { isPublished: true, type: 'film' };

      if (req.query.sport && req.query.sport !== 'all') query.sportTypes = req.query.sport;
      if (req.query.year) query.releaseYear = parseInt(req.query.year, 10);
      if (req.query.producer) query.producedBy = req.query.producer;
      if (req.query.q) {
        const escaped = req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { title: { $regex: escaped, $options: 'i' } },
          { description: { $regex: escaped, $options: 'i' } },
          { producedBy: { $regex: escaped, $options: 'i' } },
          { riders: { $regex: escaped, $options: 'i' } },
        ];
      }

      const [films, total] = await Promise.all([
        videosCollection
          .find(query, { projection: publicFilmProjection })
          .sort({ releaseYear: -1, title: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),
        videosCollection.countDocuments(query),
      ]);

      res.send({ films, page, limit, total, pages: Math.ceil(total / limit) });
    } catch (error) {
      console.error('Error fetching film catalog:', error);
      res.status(500).send({ error: 'Failed to fetch film catalog' });
    }
  });

  router.get('/films/:slug', async (req, res) => {
    try {
      const film = await videosCollection.findOne(
        { slug: req.params.slug, isPublished: true, type: 'film' },
        { projection: publicFilmProjection },
      );
      if (!film) return res.status(404).send({ error: 'Film not found' });
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      res.send(film);
    } catch (error) {
      console.error('Error fetching film:', error);
      res.status(500).send({ error: 'Failed to fetch film' });
    }
  });

  // Get all videos (with optional filters)
  router.get('/videos', async (req, res) => {
    try {
      const { sport, collection, type, sort = 'createdAt', limit = 50, page = 1 } = req.query;
      const query = { isPublished: true };

      if (sport && sport !== 'all') {
        query.sportTypes = sport;
      }
      if (collection) {
        query.collectionId = collection;
      }
      if (type && type !== 'all') {
        query.type = type;
      }

      const sortOptions = {};
      if (sort === 'title') sortOptions.title = 1;
      else if (sort === 'releaseYear') sortOptions.releaseYear = -1;
      else if (sort === 'releaseYearAsc') sortOptions.releaseYear = 1;
      else if (sort === 'popular') sortOptions.viewCount = -1;
      else if (sort === 'rating') sortOptions.avgRating = -1;
      else sortOptions.createdAt = -1;

      // Keep pagination deterministic when several videos share the primary sort value.
      sortOptions._id = -1;
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);

      const videos = await videosCollection
        .find(query)
        .sort(sortOptions)
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit)
        .toArray();

      res.send(videos);
    } catch (error) {
      console.error('Error fetching videos:', error);
      res.status(500).send({ error: 'Failed to fetch videos' });
    }
  });

  // Get featured video
  router.get('/featured', async (_req, res) => {
    try {
      const featured = await videosCollection.findOne({
        isPublished: true,
        isFeatured: true,
      });
      res.send(featured);
    } catch (error) {
      console.error('Error fetching featured:', error);
      res.status(500).send({ error: 'Failed to fetch featured video' });
    }
  });

  // Get single video details
  router.get('/videos/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const video = await videosCollection.findOne({
        ...videoIdentityQuery(id),
        isPublished: true,
      });

      if (!video) {
        return res.status(404).send({ error: 'Video not found' });
      }

      const canonicalVideoId = video._id.toString();
      const videoIds = id === canonicalVideoId ? [canonicalVideoId] : [canonicalVideoId, id];

      // Increment view count
      await videosCollection.updateOne({ _id: video._id }, { $inc: { viewCount: 1 } });

      // Get reaction counts
      const [loveCount, respectCount] = await Promise.all([
        reactionsCollection.countDocuments({ videoId: { $in: videoIds }, type: 'love' }),
        reactionsCollection.countDocuments({ videoId: { $in: videoIds }, type: 'respect' }),
      ]);

      // Get comment count
      const commentCount = await commentsCollection.countDocuments({
        videoId: { $in: videoIds },
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
      console.error('Error fetching video:', error);
      res.status(500).send({ error: 'Failed to fetch video' });
    }
  });

  // Get video stream URL (prefers Bunny.net HLS, falls back to Google Drive)
  router.get('/videos/:id/stream', async (req, res) => {
    try {
      const { id } = req.params;
      const video = await videosCollection.findOne({
        ...videoIdentityQuery(id),
        isPublished: true,
      });

      if (!video) {
        return res.status(404).send({ error: 'Video not found' });
      }

      // Prefer Bunny.net HLS if available (adaptive streaming)
      if (video.bunnyVideoId || video.hlsUrl) {
        // Get signed URLs for token-authenticated CDN
        const videoId = video.bunnyVideoId || video.hlsUrl.split('/').slice(-2)[0];
        const urls = getVideoUrls(videoId, true);

        return res.send({
          type: 'hls',
          hlsUrl: urls.hlsUrl,
          mp4Url: urls.quality720p,
          thumbnailUrl: video.thumbnails?.poster || urls.thumbnailUrl,
          // Include all quality options
          qualities: {
            '360p': urls.quality360p,
            '480p': urls.quality480p,
            '720p': urls.quality720p,
            '1080p': urls.quality1080p,
          },
        });
      }

      // Fall back to Google Drive
      if (video.driveFileId) {
        return res.send({
          type: 'drive',
          streamUrl: `https://drive.google.com/uc?export=download&id=${video.driveFileId}`,
          embedUrl: `https://drive.google.com/file/d/${video.driveFileId}/preview`,
        });
      }

      res.status(404).send({ error: 'No video source available' });
    } catch (error) {
      console.error('Error getting stream URL:', error);
      res.status(500).send({ error: 'Failed to get stream URL' });
    }
  });

  // Get all collections
  router.get('/collections', async (req, res) => {
    try {
      const { sport } = req.query;
      const query = { isPublished: true };

      if (sport && sport !== 'all') {
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
      console.error('Error fetching collections:', error);
      res.status(500).send({ error: 'Failed to fetch collections' });
    }
  });

  // Get single collection with all videos
  router.get('/collections/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const collection = await collectionsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!collection) {
        return res.status(404).send({ error: 'Collection not found' });
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
      console.error('Error fetching collection:', error);
      res.status(500).send({ error: 'Failed to fetch collection' });
    }
  });

  // ============================================
  // REACTIONS (Authenticated)
  // ============================================

  // Get user's reaction on a video
  router.get('/videos/:id/reaction', auth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      const reactions = await reactionsCollection.find({ videoId: id, userId }).toArray();

      const userReactions = {
        love: reactions.some((r) => r.type === 'love'),
        respect: reactions.some((r) => r.type === 'respect'),
      };

      res.send(userReactions);
    } catch (error) {
      console.error('Error fetching reaction:', error);
      res.status(500).send({ error: 'Failed to fetch reaction' });
    }
  });

  // Add reaction
  router.post('/videos/:id/reaction', auth, async (req, res) => {
    try {
      const { id } = req.params;
      const { type } = req.body;
      const userId = req.user.userId;

      if (!['love', 'respect'].includes(type)) {
        return res.status(400).send({ error: 'Invalid reaction type' });
      }

      // Check if already reacted
      const existing = await reactionsCollection.findOne({
        videoId: id,
        userId,
        type,
      });

      if (existing) {
        return res.status(400).send({ error: 'Already reacted' });
      }

      await reactionsCollection.insertOne({
        videoId: id,
        userId,
        type,
        createdAt: new Date(),
      });

      res.send({ success: true });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).send({ error: 'Failed to add reaction' });
    }
  });

  // Remove reaction
  router.delete('/videos/:id/reaction/:type', auth, async (req, res) => {
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
      console.error('Error removing reaction:', error);
      res.status(500).send({ error: 'Failed to remove reaction' });
    }
  });

  // ============================================
  // COMMENTS (Authenticated)
  // ============================================

  // Get comments for a video
  router.get('/videos/:id/comments', async (req, res) => {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

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
          { $limit: parseInt(limit, 10) },
          {
            $lookup: {
              from: 'users',
              let: { odId: { $toObjectId: '$userId' } },
              pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$odId'] } } },
                { $project: { name: 1, imageUri: 1 } },
              ],
              as: 'user',
            },
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
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
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          hasMore: skip + comments.length < total,
        },
      });
    } catch (error) {
      console.error('Error fetching comments:', error);
      res.status(500).send({ error: 'Failed to fetch comments' });
    }
  });

  // Add comment
  router.post('/videos/:id/comments', auth, async (req, res) => {
    try {
      const { id } = req.params;
      const { content, parentCommentId } = req.body;
      const userId = req.user.userId;

      if (!content || !content.trim()) {
        return res.status(400).send({ error: 'Comment content required' });
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
      console.error('Error adding comment:', error);
      res.status(500).send({ error: 'Failed to add comment' });
    }
  });

  // Delete comment (soft delete)
  router.delete('/videos/:videoId/comments/:commentId', auth, async (req, res) => {
    try {
      const { commentId } = req.params;
      const userId = req.user.userId;

      const comment = await commentsCollection.findOne({
        _id: new ObjectId(commentId),
      });

      if (!comment) {
        return res.status(404).send({ error: 'Comment not found' });
      }

      // Only allow owner or admin to delete
      if (comment.userId !== userId && req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Not authorized' });
      }

      await commentsCollection.updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );

      res.send({ success: true });
    } catch (error) {
      console.error('Error deleting comment:', error);
      res.status(500).send({ error: 'Failed to delete comment' });
    }
  });

  // ============================================
  // VIDEO REQUESTS (Authenticated)
  // ============================================

  // Submit a video request
  router.post('/requests', auth, async (req, res) => {
    try {
      const { title, description, link } = req.body;
      const userId = req.user.userId;

      if (!title) {
        return res.status(400).send({ error: 'Title required' });
      }

      const request = {
        userId,
        title,
        description: description || '',
        link: link || '',
        status: 'pending',
        createdAt: new Date(),
      };

      const result = await requestsCollection.insertOne(request);
      request._id = result.insertedId;

      res.status(201).send(request);
    } catch (error) {
      console.error('Error submitting request:', error);
      res.status(500).send({ error: 'Failed to submit request' });
    }
  });

  // Get user's requests
  router.get('/requests/mine', auth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const requests = await requestsCollection.find({ userId }).sort({ createdAt: -1 }).toArray();

      res.send(requests);
    } catch (error) {
      console.error('Error fetching requests:', error);
      res.status(500).send({ error: 'Failed to fetch requests' });
    }
  });

  // ============================================
  // ADMIN ROUTES
  // ============================================

  // Sync videos from Google Drive folder (recursively scans sport subfolders)
  router.post('/admin/sync', auth, async (req, res) => {
    try {
      // Check if admin
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      console.log('Starting Google Drive sync...');
      console.log('Root Folder ID:', FOLDER_ID);

      // Map folder names to sport types
      const sportFolderMap = {
        skateboarding: 'skateboarding',
        snowboarding: 'snowboarding',
        skiing: 'skiing',
        bmx: 'bmx',
        mtb: 'mtb',
        scootering: 'scooter',
        scooter: 'scooter',
        wakeboarding: 'wakeboarding',
        surf: 'surf',
        rollerblading: 'rollerblading',
      };

      // First, get all subfolders in the root folder
      const foldersResponse = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 100,
      });

      const sportFolders = foldersResponse.data.files || [];
      console.log(`Found ${sportFolders.length} sport folders`);

      let added = 0;
      let updated = 0;
      let totalVideoFiles = 0;

      // Scan each sport folder for videos
      for (const folder of sportFolders) {
        const sportType = sportFolderMap[folder.name.toLowerCase()] || folder.name.toLowerCase();
        console.log(`Scanning folder: ${folder.name} (sport: ${sportType})`);

        const videosResponse = await drive.files.list({
          q: `'${folder.id}' in parents and trashed = false`,
          fields:
            'files(id, name, mimeType, size, createdTime, modifiedTime, thumbnailLink, webViewLink)',
          pageSize: 100,
        });

        const files = videosResponse.data.files || [];
        const videoFiles = files.filter((file) => {
          const ext = path.extname(file.name).toLowerCase();
          return VIDEO_EXTENSIONS.includes(ext) || file.mimeType.startsWith('video/');
        });

        console.log(`  Found ${videoFiles.length} videos in ${folder.name}`);
        totalVideoFiles += videoFiles.length;

        for (const file of videoFiles) {
          const existing = await videosCollection.findOne({
            driveFileId: file.id,
          });

          const videoData = {
            driveFileId: file.id,
            driveFileName: file.name,
            title: path.basename(file.name, path.extname(file.name)),
            mimeType: file.mimeType,
            size: parseInt(file.size, 10) || 0,
            driveThumbnail: file.thumbnailLink,
            driveViewLink: file.webViewLink,
            driveModifiedTime: file.modifiedTime,
            sportTypes: [sportType],
            driveFolderId: folder.id,
            driveFolderName: folder.name,
            updatedAt: new Date(),
          };

          if (existing) {
            await videosCollection.updateOne({ _id: existing._id }, { $set: videoData });
            updated++;
          } else {
            await videosCollection.insertOne({
              ...videoData,
              description: '',
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
      }

      res.send({
        success: true,
        message: `Sync complete. Added: ${added}, Updated: ${updated}`,
        sportFolders: sportFolders.length,
        totalVideoFiles,
      });
    } catch (error) {
      console.error('Error syncing from Drive:', error);
      res.status(500).send({ error: `Failed to sync: ${error.message}` });
    }
  });

  // Get all videos (admin - includes unpublished)
  router.get('/admin/videos', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const videos = await videosCollection.find({}).sort({ createdAt: -1 }).toArray();

      res.send(videos);
    } catch (error) {
      console.error('Error fetching admin videos:', error);
      res.status(500).send({ error: 'Failed to fetch videos' });
    }
  });

  // Get single video (admin - includes unpublished drafts, does NOT bump viewCount)
  router.get('/admin/videos/:id', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const video = await videosCollection.findOne({ _id: new ObjectId(req.params.id) });

      if (!video) {
        return res.status(404).send({ error: 'Video not found' });
      }

      res.send(video);
    } catch (error) {
      console.error('Error fetching admin video:', error);
      res.status(500).send({ error: 'Failed to fetch video' });
    }
  });

  // Fetch metadata from YouTube URL (admin)
  router.post('/admin/youtube-metadata', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      // Accept both 'url' and 'youtubeUrl' for flexibility
      const url = req.body.url || req.body.youtubeUrl;
      if (!url) {
        return res.status(400).send({ error: 'YouTube URL required' });
      }

      // Extract video ID from various YouTube URL formats
      let videoId = null;
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /youtube\.com\/shorts\/([^&\n?#]+)/,
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          videoId = match[1];
          break;
        }
      }

      if (!videoId) {
        return res.status(400).send({ error: 'Invalid YouTube URL' });
      }

      // Use YouTube oEmbed API (no API key needed)
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const oembedResponse = await axios.get(oembedUrl);
      const oembed = oembedResponse.data;

      // Try to extract year from title (common patterns like "(2003)" or "2003")
      const yearMatch = oembed.title.match(/\((\d{4})\)|\b(19\d{2}|20\d{2})\b/);
      const releaseYear = yearMatch ? parseInt(yearMatch[1] || yearMatch[2], 10) : null;

      // Check if maxresdefault thumbnail exists (not all videos have it)
      const maxresThumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      const hqThumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      let thumbnail = hqThumbnail; // Default to HQ (always available)
      try {
        // Check if maxres exists with a HEAD request
        const maxresCheck = await axios.head(maxresThumbnail);
        if (maxresCheck.status === 200) {
          thumbnail = maxresThumbnail;
        }
      } catch (_err) {
        // maxresdefault doesn't exist, use hqdefault
        console.log(`No maxres thumbnail for ${videoId}, using hqdefault`);
      }

      res.send({
        videoId,
        title: oembed.title,
        author: oembed.author_name,
        thumbnail,
        thumbnailHQ: hqThumbnail,
        releaseYear,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      });
    } catch (error) {
      console.error('Error fetching YouTube metadata:', error);
      res.status(500).send({ error: 'Failed to fetch YouTube metadata' });
    }
  });

  // Create video in Bunny.net library (admin)
  router.post('/admin/bunny/create-video', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { title } = req.body;
      if (!title) {
        return res.status(400).send({ error: 'Title required' });
      }

      // Create video in Bunny.net Stream library
      const response = await axios.post(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        { title },
        {
          headers: {
            AccessKey: BUNNY_LIBRARY_API_KEY,
            'Content-Type': 'application/json',
          },
        },
      );

      const bunnyVideo = response.data;

      res.send({
        // Fields expected by frontend
        guid: bunnyVideo.guid,
        libraryId: BUNNY_LIBRARY_ID,
        uploadKey: BUNNY_LIBRARY_API_KEY,
        cdnHostname: BUNNY_CDN_HOSTNAME,
        // Additional info
        bunnyVideoId: bunnyVideo.guid,
        uploadUrl: `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideo.guid}`,
        title: bunnyVideo.title,
      });
    } catch (error) {
      console.error('Error creating Bunny video:', error);
      res.status(500).send({ error: `Failed to create video: ${error.message}` });
    }
  });

  // Get Bunny.net upload URL for a video (admin)
  router.get('/admin/bunny/upload-url/:bunnyVideoId', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { bunnyVideoId } = req.params;

      // Return the TUS upload endpoint for resumable uploads
      res.send({
        uploadUrl: `https://video.bunnycdn.com/tusupload`,
        authorizationSignature: BUNNY_LIBRARY_API_KEY,
        authorizationExpire: Date.now() + 86400000, // 24 hours
        videoId: bunnyVideoId,
        libraryId: BUNNY_LIBRARY_ID,
      });
    } catch (error) {
      console.error('Error getting upload URL:', error);
      res.status(500).send({ error: 'Failed to get upload URL' });
    }
  });

  // Get Bunny.net video status (admin)
  router.get('/admin/bunny/video/:bunnyVideoId', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { bunnyVideoId } = req.params;

      const response = await axios.get(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyVideoId}`,
        {
          headers: { AccessKey: BUNNY_LIBRARY_API_KEY },
        },
      );

      const video = response.data;

      res.send({
        bunnyVideoId: video.guid,
        title: video.title,
        status: video.status, // 0=created, 1=uploaded, 2=processing, 3=transcoding, 4=finished, 5=error
        hlsUrl:
          video.status === 4 ? `https://${BUNNY_CDN_HOSTNAME}/${video.guid}/playlist.m3u8` : null,
        thumbnailUrl:
          video.status >= 4 ? `https://${BUNNY_CDN_HOSTNAME}/${video.guid}/thumbnail.jpg` : null,
        duration: video.length,
        width: video.width,
        height: video.height,
      });
    } catch (error) {
      console.error('Error getting Bunny video:', error);
      res.status(500).send({ error: 'Failed to get video status' });
    }
  });

  // Create new video entry (admin)
  router.post('/admin/videos', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const {
        slug,
        type,
        title,
        description,
        sportTypes,
        tags,
        releaseYear,
        producedBy,
        riders,
        sponsors,
        duration,
        thumbnails,
        bunnyVideoId,
        hlsUrl,
        youtubeUrl,
        isPublished,
        isFeatured,
        collectionId,
        releaseSeason,
        directors,
        locations,
        watchOptions,
        sourceRecords,
        rights,
        availabilityStatus,
        seo,
      } = req.body;

      if (!title) {
        return res.status(400).send({ error: 'Title required' });
      }

      const video = {
        slug: slug || null,
        type: type || 'film',
        title,
        description: description || '',
        sportTypes: sportTypes || [],
        tags: tags || [],
        releaseYear: releaseYear || null,
        producedBy: producedBy || '',
        riders: riders || [],
        sponsors: sponsors || [],
        duration: duration || null,
        thumbnails: thumbnails || {},
        bunnyVideoId: bunnyVideoId || null,
        hlsUrl: hlsUrl || null,
        youtubeUrl: youtubeUrl || null,
        isPublished: isPublished || false,
        isFeatured: isFeatured || false,
        viewCount: 0,
        collectionId: collectionId || null,
        releaseSeason: releaseSeason || '',
        directors: directors || [],
        locations: locations || [],
        watchOptions: watchOptions || [],
        sourceRecords: sourceRecords || [],
        rights: rights || { hostingStatus: 'external_only' },
        availabilityStatus: availabilityStatus || 'unknown',
        seo: seo || {},
        order: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await videosCollection.insertOne(video);
      video._id = result.insertedId;

      res.status(201).send(video);
    } catch (error) {
      console.error('Error creating video:', error);
      res.status(500).send({ error: 'Failed to create video' });
    }
  });

  // Update video metadata (admin)
  router.put('/admin/videos/:id', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { id } = req.params;
      const {
        slug,
        type,
        title,
        description,
        sportTypes,
        tags,
        releaseYear,
        producedBy,
        riders,
        sponsors,
        duration,
        thumbnails,
        bunnyVideoId,
        hlsUrl,
        youtubeUrl,
        isPublished,
        isFeatured,
        collectionId,
        order,
        releaseSeason,
        directors,
        locations,
        watchOptions,
        sourceRecords,
        rights,
        availabilityStatus,
        seo,
      } = req.body;

      const updateData = { updatedAt: new Date() };

      if (title !== undefined) updateData.title = title;
      if (slug !== undefined) updateData.slug = slug;
      if (type !== undefined) updateData.type = type;
      if (description !== undefined) updateData.description = description;
      if (sportTypes !== undefined) updateData.sportTypes = sportTypes;
      if (tags !== undefined) updateData.tags = tags;
      if (releaseYear !== undefined) updateData.releaseYear = releaseYear;
      if (producedBy !== undefined) updateData.producedBy = producedBy;
      if (riders !== undefined) updateData.riders = riders;
      if (sponsors !== undefined) updateData.sponsors = sponsors;
      if (duration !== undefined) updateData.duration = duration;
      if (thumbnails !== undefined) updateData.thumbnails = thumbnails;
      if (bunnyVideoId !== undefined) updateData.bunnyVideoId = bunnyVideoId;
      if (hlsUrl !== undefined) updateData.hlsUrl = hlsUrl;
      if (youtubeUrl !== undefined) updateData.youtubeUrl = youtubeUrl;
      if (isPublished !== undefined) updateData.isPublished = isPublished;
      if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
      if (collectionId !== undefined) updateData.collectionId = collectionId;
      if (order !== undefined) updateData.order = order;
      if (releaseSeason !== undefined) updateData.releaseSeason = releaseSeason;
      if (directors !== undefined) updateData.directors = directors;
      if (locations !== undefined) updateData.locations = locations;
      if (watchOptions !== undefined) updateData.watchOptions = watchOptions;
      if (sourceRecords !== undefined) updateData.sourceRecords = sourceRecords;
      if (rights !== undefined) updateData.rights = rights;
      if (availabilityStatus !== undefined) updateData.availabilityStatus = availabilityStatus;
      if (seo !== undefined) updateData.seo = seo;

      await videosCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

      const updated = await videosCollection.findOne({ _id: new ObjectId(id) });
      res.send(updated);
    } catch (error) {
      console.error('Error updating video:', error);
      res.status(500).send({ error: 'Failed to update video' });
    }
  });

  // Delete video (admin)
  router.delete('/admin/videos/:id', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { id } = req.params;
      await videosCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ success: true });
    } catch (error) {
      console.error('Error deleting video:', error);
      res.status(500).send({ error: 'Failed to delete video' });
    }
  });

  // Create collection (admin)
  router.post('/admin/collections', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { name, description, sportTypes, order } = req.body;

      if (!name) {
        return res.status(400).send({ error: 'Name required' });
      }

      const collection = {
        name,
        description: description || '',
        sportTypes: sportTypes || [],
        isPublished: true,
        order: order || 0,
        createdAt: new Date(),
      };

      const result = await collectionsCollection.insertOne(collection);
      collection._id = result.insertedId;

      res.status(201).send(collection);
    } catch (error) {
      console.error('Error creating collection:', error);
      res.status(500).send({ error: 'Failed to create collection' });
    }
  });

  // Update collection (admin)
  router.put('/admin/collections/:id', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { id } = req.params;
      const { name, description, sportTypes, isPublished, order } = req.body;

      const updateData = { updatedAt: new Date() };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (sportTypes !== undefined) updateData.sportTypes = sportTypes;
      if (isPublished !== undefined) updateData.isPublished = isPublished;
      if (order !== undefined) updateData.order = order;

      await collectionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });

      const updated = await collectionsCollection.findOne({ _id: new ObjectId(id) });
      res.send(updated);
    } catch (error) {
      console.error('Error updating collection:', error);
      res.status(500).send({ error: 'Failed to update collection' });
    }
  });

  // Get all requests (admin)
  router.get('/admin/requests', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const requests = await requestsCollection
        .aggregate([
          { $sort: { createdAt: -1 } },
          {
            $lookup: {
              from: 'users',
              let: { odId: { $toObjectId: '$userId' } },
              pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$odId'] } } },
                { $project: { name: 1, email: 1 } },
              ],
              as: 'user',
            },
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        ])
        .toArray();

      res.send(requests);
    } catch (error) {
      console.error('Error fetching requests:', error);
      res.status(500).send({ error: 'Failed to fetch requests' });
    }
  });

  // Update request status (admin)
  router.put('/admin/requests/:id', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).send({ error: 'Admin access required' });
      }

      const { id } = req.params;
      const { status } = req.body;

      if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
        return res.status(400).send({ error: 'Invalid status' });
      }

      await requestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, updatedAt: new Date() } },
      );

      res.send({ success: true });
    } catch (error) {
      console.error('Error updating request:', error);
      res.status(500).send({ error: 'Failed to update request' });
    }
  });

  return router;
};
