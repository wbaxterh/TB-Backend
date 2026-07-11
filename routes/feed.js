/**
 * Feed Routes - "The Feed" Social API
 * Handles user-generated content, reactions, and comments
 */

const express = require('express');
const auth = require('../middleware/auth');
const ObjectId = require('mongodb').ObjectId;

// Socket emit functions for real-time updates
const { emitNewComment, emitCommentDeleted, emitCommentLoved } = require('../socket/feedSocket');

// Bunny Stream for signed video URLs
const { getVideoUrls } = require('../services/bunnyStream');

// Sport types enum
const SPORT_TYPES = [
  'skateboarding',
  'snowboarding',
  'skiing',
  'bmx',
  'mtb',
  'scooter',
  'surf',
  'wakeboarding',
  'rollerblading',
];

// Feed algorithm weights
const HOMIE_BOOST = 2.5;
const ENGAGEMENT_WEIGHT = 0.35;
const RECENCY_WEIGHT = 0.25;
const COMPLETION_WEIGHT = 0.25;
const _INTERACTION_WEIGHT = 0.15;

module.exports = (db) => {
  const router = express.Router();
  const feedCollection = db.collection('feed_posts');
  const reactionsCollection = db.collection('reactions');
  const commentsCollection = db.collection('comments');
  const usersCollection = db.collection('users');
  const savedPostsCollection = db.collection('saved_posts');
  const spotsCollection = db.collection('spots');
  const trickCollection = db.collection('tricks');

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
      { projection: { homies: 1 } },
    );
    return user?.homies || [];
  };

  // Helper: Populate user data and signed video URLs for posts
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

    // Batch-enrich linked spots so a tagged spot shows on posts EVERYWHERE (feed
    // lists, profile, etc.) — not just on the single-post view.
    const spotIds = [...new Set(posts.map((p) => p.spotId).filter(Boolean))];
    const spotMap = {};
    if (spotIds.length > 0) {
      const spots = await spotsCollection
        .find({ _id: { $in: spotIds.map((id) => new ObjectId(id)) } })
        .project({ name: 1, city: 1, state: 1, imageURL: 1, category: 1 })
        .toArray();
      spots.forEach((s) => {
        spotMap[s._id.toString()] = s;
      });
    }

    return posts.map((post) => {
      const enrichedPost = {
        ...post,
        user: userMap[post.userId] || { name: 'Unknown' },
      };

      if (post.spotId && spotMap[String(post.spotId)]) {
        enrichedPost.spot = spotMap[String(post.spotId)];
      }

      // Add signed video URLs for video posts
      if (post.mediaType === 'video' && post.bunnyVideoId) {
        try {
          const urls = getVideoUrls(post.bunnyVideoId, true);
          enrichedPost.signedHlsUrl = urls.hlsUrl;
          enrichedPost.signedMp4Url = urls.quality720p;
          enrichedPost.signedThumbnailUrl = urls.thumbnailUrl;
        } catch (err) {
          console.error('Error generating signed URLs:', err);
        }
      }

      return enrichedPost;
    });
  };

  // =============================================
  // FEED ENDPOINTS
  // =============================================

  // Get algorithmic feed (homies prioritized, supports sort modes)
  router.get('/', async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      const offset = (page - 1) * limit;
      const sortMode = req.query.sort || 'recent'; // 'recent', 'trending', 'algorithmic'
      const prioritizeHomies = req.query.prioritizeHomies !== 'false'; // default true

      // Get user's homies if authenticated
      let userHomies = [];
      let userId = null;
      if (req.headers['x-auth-token']) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(
            req.headers['x-auth-token'],
            process.env.JWT_SECRET || 'jwtPrivateKey',
          );
          userId = decoded.userId;
          userHomies = await getHomieIds(userId);
        } catch (_e) {
          // Invalid token, continue without auth
        }
      }

      // Get candidate posts
      const query = {
        status: 'published',
      };

      // Filter visibility based on auth
      if (userId) {
        query.$or = [
          { visibility: 'public' },
          { visibility: 'homies', userId: { $in: [userId, ...userHomies] } },
          { userId: userId }, // Own posts
        ];
      } else {
        query.visibility = 'public';
      }

      let posts;
      let totalCount;

      if (sortMode === 'recent') {
        // Recent mode: Sort by createdAt, but boost homies to top
        // First, get homies' recent posts
        let homiePosts = [];
        let otherPosts = [];

        if (prioritizeHomies && userId && userHomies.length > 0) {
          // Get homies' posts (including own posts)
          const homieQuery = {
            ...query,
            userId: { $in: [userId, ...userHomies.map((id) => id.toString())] },
          };
          homiePosts = await feedCollection
            .find(homieQuery)
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();

          // Get other public posts
          const otherQuery = {
            status: 'published',
            visibility: 'public',
            userId: { $nin: [userId, ...userHomies.map((id) => id.toString())] },
          };
          otherPosts = await feedCollection
            .find(otherQuery)
            .sort({ createdAt: -1 })
            .limit(300)
            .toArray();

          // Interleave: Show homies posts first in each batch, then others
          // Ratio: ~60% homies, ~40% others when both available
          const homieRatio = 0.6;
          const homiesPerPage = Math.ceil(limit * homieRatio);
          const othersPerPage = limit - homiesPerPage;

          const homieOffset = Math.floor(offset * homieRatio);
          const otherOffset = offset - homieOffset;

          const pagedHomies = homiePosts.slice(homieOffset, homieOffset + homiesPerPage);
          const pagedOthers = otherPosts.slice(otherOffset, otherOffset + othersPerPage);

          // Combine and sort by date (homies will naturally be mixed in by recency)
          posts = [...pagedHomies, ...pagedOthers].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
          );
          totalCount = homiePosts.length + otherPosts.length;
        } else {
          // No homies or not authenticated - just sort by recency
          posts = await feedCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();
          totalCount = await feedCollection.countDocuments(query);
        }
      } else if (sortMode === 'trending') {
        // Trending mode: Sort by engagement in last 7 days
        query.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
        posts = await feedCollection
          .find(query)
          .sort({
            'stats.loveCount': -1,
            'stats.respectCount': -1,
            'stats.commentCount': -1,
            createdAt: -1,
          })
          .skip(offset)
          .limit(limit)
          .toArray();
        totalCount = await feedCollection.countDocuments(query);
      } else {
        // Algorithmic mode: Use scoring function (original behavior)
        const allPosts = await feedCollection.find(query).limit(500).toArray();

        // Score and sort posts
        const now = Date.now();
        const scoredPosts = allPosts.map((post) => {
          const hoursOld = (now - new Date(post.createdAt).getTime()) / 3600000;
          return {
            post,
            score: calculateFeedScore(post, userHomies, hoursOld),
          };
        });

        scoredPosts.sort((a, b) => b.score - a.score);
        posts = scoredPosts.slice(offset, offset + limit).map((s) => s.post);
        totalCount = scoredPosts.length;
      }

      // Populate user data
      const populatedPosts = await populatePostUsers(posts);

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
          hasMore: offset + limit < totalCount,
        },
      });
    } catch (error) {
      console.error('Error fetching feed:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get trending posts
  router.get('/trending', async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      const skip = (page - 1) * limit;
      const sport = req.query.sport;

      const query = {
        status: 'published',
        visibility: 'public',
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      };

      if (sport && sport !== 'all' && SPORT_TYPES.includes(sport)) {
        query.sportTypes = sport;
      }

      // Sort by engagement metrics
      const posts = await feedCollection
        .find(query)
        .sort({
          'stats.loveCount': -1,
          'stats.respectCount': -1,
          'stats.commentCount': -1,
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
      console.error('Error fetching trending:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get user's posts
  router.get('/user/:userId', async (req, res) => {
    const { userId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skip = (page - 1) * limit;

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({ error: 'Invalid user ID' });
    }

    try {
      const query = {
        userId: userId,
        status: 'published',
      };

      // Only show public posts unless viewing own profile
      let requesterId = null;
      if (req.headers['x-auth-token']) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(
            req.headers['x-auth-token'],
            process.env.JWT_SECRET || 'jwtPrivateKey',
          );
          requesterId = decoded.userId;
        } catch (_e) {}
      }

      if (requesterId !== userId) {
        query.visibility = 'public';
      }

      const [posts, total] = await Promise.all([
        feedCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
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
      console.error('Error fetching user posts:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get sport-specific feed
  router.get('/sport/:sportType', async (req, res) => {
    const { sportType } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skip = (page - 1) * limit;

    if (!SPORT_TYPES.includes(sportType)) {
      return res.status(400).send({ error: 'Invalid sport type' });
    }

    try {
      const query = {
        sportTypes: sportType,
        status: 'published',
        visibility: 'public',
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
      console.error('Error fetching sport feed:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get single post details
  router.get('/:postId', async (req, res) => {
    const { postId } = req.params;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      if (!post) {
        return res.status(404).send({ error: 'Post not found' });
      }

      const populatedPosts = await populatePostUsers([post]);
      const enrichedPost = populatedPosts[0];

      // Populate spot data if spotId exists
      if (post.spotId) {
        try {
          const spot = await spotsCollection.findOne(
            { _id: new ObjectId(post.spotId) },
            { projection: { name: 1, city: 1, state: 1 } },
          );
          if (spot) enrichedPost.spot = spot;
        } catch (_e) {}
      }

      // Populate trick names if trickIds exist
      if (post.trickIds && post.trickIds.length > 0) {
        try {
          const trickObjIds = post.trickIds.map((id) => new ObjectId(id));
          const trickDocs = await trickCollection
            .find({ _id: { $in: trickObjIds } })
            .project({ name: 1 })
            .toArray();
          enrichedPost.linkedTricks = trickDocs;
        } catch (_e) {}
      }

      res.send(enrichedPost);
    } catch (error) {
      console.error('Error fetching post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get signed stream URL for a post's video
  router.get('/:postId/stream', async (req, res) => {
    const { postId } = req.params;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      if (!post) {
        return res.status(404).send({ error: 'Post not found' });
      }

      if (post.mediaType !== 'video' || !post.bunnyVideoId) {
        return res.status(400).send({ error: 'Post does not have a video' });
      }

      // Get signed URLs (valid for 1 hour)
      const urls = getVideoUrls(post.bunnyVideoId, true);

      res.send({
        type: 'bunny',
        videoId: post.bunnyVideoId,
        hlsUrl: urls.hlsUrl,
        mp4Url: urls.quality720p,
        thumbnailUrl: urls.thumbnailUrl,
      });
    } catch (error) {
      console.error('Error getting stream URL:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // DEBUG: Test token generation for a video
  // Access via: GET /api/feed/debug-token/:videoId
  router.get('/debug-token/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const crypto = require('crypto');

    const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY;
    const libraryApiKey = process.env.BUNNY_LIBRARY_API_KEY;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;

    const expiration = Math.floor(Date.now() / 1000) + 3600;
    const filename = 'play_720p.mp4';
    const path = `/${videoId}/${filename}`;

    // Generate token with BUNNY_STREAM_TOKEN_KEY
    const signatureString1 = tokenKey + path + expiration;
    const hash1 = crypto.createHash('sha256').update(signatureString1).digest();
    const token1 = hash1
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Generate token with BUNNY_LIBRARY_API_KEY (fallback)
    const signatureString2 = libraryApiKey + path + expiration;
    const hash2 = crypto.createHash('sha256').update(signatureString2).digest();
    const token2 = hash2
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    res.json({
      debug: {
        message: 'Token generation debug info',
        tokenKeySet: !!tokenKey,
        tokenKeyPreview: tokenKey ? `${tokenKey.substring(0, 8)}...` : 'NOT SET',
        libraryApiKeyPreview: libraryApiKey ? `${libraryApiKey.substring(0, 8)}...` : 'NOT SET',
        cdnHostname,
        videoId,
        path,
        expiration,
        expirationDate: new Date(expiration * 1000).toISOString(),
      },
      urls: {
        withTokenKey: `https://${cdnHostname}${path}?token=${token1}&expires=${expiration}`,
        withLibraryKey: `https://${cdnHostname}${path}?token=${token2}&expires=${expiration}`,
        unsigned: `https://${cdnHostname}${path}`,
      },
      instructions: [
        '1. Copy each URL and test in browser',
        "2. If 'withTokenKey' works, BUNNY_STREAM_TOKEN_KEY is correct",
        "3. If 'withLibraryKey' works, use that instead",
        "4. If 'unsigned' works, token auth might be disabled",
        '5. If none work, check Bunny dashboard for correct token key',
      ],
    });
  });

  // =============================================
  // POST CRUD ENDPOINTS
  // =============================================

  // Create new post
  router.post('/', auth, async (req, res) => {
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
      spotId,
      trickIds,
    } = req.body;

    if (!mediaType || !['video', 'image', 'carousel'].includes(mediaType)) {
      return res.status(400).send({ error: 'Invalid media type' });
    }

    // Validate video duration (max 3 minutes = 180 seconds)
    if (mediaType === 'video' && duration && duration > 180) {
      return res.status(400).send({ error: 'Video duration exceeds 3 minute limit' });
    }

    try {
      const post = {
        userId: userId,
        mediaType,
        bunnyVideoId: bunnyVideoId || null,
        hlsUrl: hlsUrl || null,
        thumbnailUrl: thumbnailUrl || null,
        imageUrls: imageUrls || [],
        caption: caption || '',
        sportTypes: sportTypes || [],
        tricks: tricks || [],
        location: location || null,
        duration: duration || null,
        aspectRatio: aspectRatio || '9:16',
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
        spotId: spotId || null,
        trickIds: trickIds || [],
        visibility: visibility || 'public',
        status: hlsUrl || imageUrls?.length > 0 ? 'published' : 'processing',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await feedCollection.insertOne(post);
      post._id = result.insertedId;

      // Populate user data
      const populatedPosts = await populatePostUsers([post]);

      res.status(201).send(populatedPosts[0]);
    } catch (error) {
      console.error('Error creating post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Update post
  router.put('/:postId', auth, async (req, res) => {
    const { postId } = req.params;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      if (!post) {
        return res.status(404).send({ error: 'Post not found' });
      }

      if (post.userId !== userId) {
        return res.status(403).send({ error: 'Access denied' });
      }

      // Only allow updating certain fields
      const allowedUpdates = [
        'caption',
        'visibility',
        'sportTypes',
        'tricks',
        'spotId',
        'trickIds',
      ];
      const updates = { updatedAt: new Date() };

      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });

      await feedCollection.updateOne({ _id: new ObjectId(postId) }, { $set: updates });

      const updated = await feedCollection.findOne({
        _id: new ObjectId(postId),
      });
      const populatedPosts = await populatePostUsers([updated]);

      res.send(populatedPosts[0]);
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Delete post
  router.delete('/:postId', auth, async (req, res) => {
    const { postId } = req.params;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      if (!post) {
        return res.status(404).send({ error: 'Post not found' });
      }

      if (post.userId !== userId) {
        return res.status(403).send({ error: 'Access denied' });
      }

      await feedCollection.deleteOne({ _id: new ObjectId(postId) });

      // Also delete related data
      await Promise.all([
        reactionsCollection.deleteMany({ postId: postId }),
        commentsCollection.deleteMany({ postId: postId }),
        savedPostsCollection.deleteMany({ postId: postId }),
      ]);

      res.send({ message: 'Post deleted' });
    } catch (error) {
      console.error('Error deleting post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // LINK ENDPOINTS (tricks + spots to posts)
  // =============================================

  // POST /feed/:postId/link-tricks — link tricks to a feed post
  router.post('/:postId/link-tricks', auth, async (req, res) => {
    const { postId } = req.params;
    const { trickIds } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }
    if (!Array.isArray(trickIds)) {
      return res.status(400).send({ error: 'trickIds must be an array' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });
      if (!post) return res.status(404).send({ error: 'Post not found' });
      if (post.userId !== userId) return res.status(403).send({ error: 'Access denied' });

      await feedCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $set: { trickIds: trickIds, updatedAt: new Date() } },
      );

      // Update linked tricks to reference this feed post
      for (const trickId of trickIds) {
        if (ObjectId.isValid(trickId)) {
          await trickCollection.updateOne(
            { _id: new ObjectId(trickId) },
            { $set: { feedPostId: postId, updatedAt: new Date() } },
          );
        }
      }

      res.send({ message: 'Tricks linked', trickIds });
    } catch (error) {
      console.error('Error linking tricks:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // POST /feed/:postId/link-spot — link a spot to a feed post
  router.post('/:postId/link-spot', auth, async (req, res) => {
    const { postId } = req.params;
    const { spotId } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });
      if (!post) return res.status(404).send({ error: 'Post not found' });
      if (post.userId !== userId) return res.status(403).send({ error: 'Access denied' });

      if (spotId && !ObjectId.isValid(spotId)) {
        return res.status(400).send({ error: 'Invalid spot ID' });
      }

      // Validate spot exists
      if (spotId) {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(spotId) });
        if (!spot) return res.status(404).send({ error: 'Spot not found' });
      }

      await feedCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $set: { spotId: spotId || null, updatedAt: new Date() } },
      );

      res.send({ message: spotId ? 'Spot linked' : 'Spot unlinked', spotId });
    } catch (error) {
      console.error('Error linking spot:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // REACTION ENDPOINTS
  // =============================================

  // Add reaction (love or respect)
  router.post('/:postId/reaction', auth, async (req, res) => {
    const { postId } = req.params;
    const { type } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    if (!type || !['love', 'respect'].includes(type)) {
      return res.status(400).send({ error: 'Invalid reaction type' });
    }

    try {
      // Check if reaction already exists
      const existing = await reactionsCollection.findOne({
        postId: postId,
        userId: userId,
        type: type,
      });

      if (existing) {
        return res.status(400).send({ error: 'Already reacted' });
      }

      // Add reaction
      await reactionsCollection.insertOne({
        postId: postId,
        userId: userId,
        type: type,
        createdAt: new Date(),
      });

      // Update post stats
      const statField = type === 'love' ? 'stats.loveCount' : 'stats.respectCount';
      await feedCollection.updateOne({ _id: new ObjectId(postId) }, { $inc: { [statField]: 1 } });

      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      res.send({
        message: 'Reaction added',
        loveCount: post.stats?.loveCount || 0,
        respectCount: post.stats?.respectCount || 0,
      });
    } catch (error) {
      console.error('Error adding reaction:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Remove reaction
  router.delete('/:postId/reaction/:type', auth, async (req, res) => {
    const { postId, type } = req.params;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    if (!['love', 'respect'].includes(type)) {
      return res.status(400).send({ error: 'Invalid reaction type' });
    }

    try {
      const result = await reactionsCollection.deleteOne({
        postId: postId,
        userId: userId,
        type: type,
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ error: 'Reaction not found' });
      }

      // Update post stats
      const statField = type === 'love' ? 'stats.loveCount' : 'stats.respectCount';
      await feedCollection.updateOne({ _id: new ObjectId(postId) }, { $inc: { [statField]: -1 } });

      const post = await feedCollection.findOne({ _id: new ObjectId(postId) });

      res.send({
        message: 'Reaction removed',
        loveCount: post.stats?.loveCount || 0,
        respectCount: post.stats?.respectCount || 0,
      });
    } catch (error) {
      console.error('Error removing reaction:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // COMMENT ENDPOINTS
  // =============================================

  // Get comments for a post
  router.get('/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skip = (page - 1) * limit;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      // Get top-level comments
      const comments = await commentsCollection
        .find({
          postId: postId,
          parentCommentId: null,
          status: 'active',
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
        user: userMap[comment.userId] || { name: 'Unknown' },
      }));

      res.send({
        comments: populatedComments,
        pagination: { page, limit },
      });
    } catch (error) {
      console.error('Error fetching comments:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Add comment
  router.post('/:postId/comments', auth, async (req, res) => {
    const { postId } = req.params;
    const { content, parentCommentId } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).send({ error: 'Comment cannot be empty' });
    }

    if (content.length > 500) {
      return res.status(400).send({ error: 'Comment too long (max 500 chars)' });
    }

    try {
      const comment = {
        postId: postId,
        userId: userId,
        parentCommentId: parentCommentId || null,
        content: content.trim(),
        loveCount: 0,
        replyCount: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await commentsCollection.insertOne(comment);
      comment._id = result.insertedId;

      // Update post comment count
      await feedCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { 'stats.commentCount': 1 } },
      );

      // If it's a reply, update parent's reply count
      if (parentCommentId) {
        await commentsCollection.updateOne(
          { _id: new ObjectId(parentCommentId) },
          { $inc: { replyCount: 1 } },
        );
      }

      // Get user data
      const user = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { name: 1, imageUri: 1 } },
      );

      const populatedComment = {
        ...comment,
        user: user || { name: 'Unknown' },
      };

      // Emit real-time event
      const io = req.app.get('io');
      if (io) {
        emitNewComment(io, postId, populatedComment);
      }

      res.status(201).send(populatedComment);
    } catch (error) {
      console.error('Error adding comment:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Delete comment
  router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const comment = await commentsCollection.findOne({
        _id: new ObjectId(commentId),
      });

      if (!comment) {
        return res.status(404).send({ error: 'Comment not found' });
      }

      if (comment.userId !== userId) {
        return res.status(403).send({ error: 'Access denied' });
      }

      // Soft delete
      await commentsCollection.updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { status: 'deleted', updatedAt: new Date() } },
      );

      // Update post comment count
      await feedCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { 'stats.commentCount': -1 } },
      );

      // Emit real-time event
      const io = req.app.get('io');
      if (io) {
        emitCommentDeleted(io, postId, commentId);
      }

      res.send({ message: 'Comment deleted' });
    } catch (error) {
      console.error('Error deleting comment:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get replies to a comment
  router.get('/:postId/comments/:commentId/replies', async (req, res) => {
    const { postId, commentId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const skip = (page - 1) * limit;

    if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const replies = await commentsCollection
        .find({
          postId: postId,
          parentCommentId: commentId,
          status: 'active',
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
        user: userMap[reply.userId] || { name: 'Unknown' },
      }));

      res.send({
        replies: populatedReplies,
        pagination: { page, limit, hasMore: replies.length === limit },
      });
    } catch (error) {
      console.error('Error fetching replies:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Love a comment
  router.post('/:postId/comments/:commentId/love', auth, async (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const commentLovesCollection = db.collection('comment_loves');

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
          { $inc: { loveCount: -1 } },
        );

        const comment = await commentsCollection.findOne({
          _id: new ObjectId(commentId),
        });

        // Emit real-time event
        const io = req.app.get('io');
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
        { $inc: { loveCount: 1 } },
      );

      const comment = await commentsCollection.findOne({
        _id: new ObjectId(commentId),
      });

      // Emit real-time event
      const io = req.app.get('io');
      if (io) {
        emitCommentLoved(io, postId, commentId, comment?.loveCount || 0);
      }

      res.send({ loved: true, loveCount: comment?.loveCount || 0 });
    } catch (error) {
      console.error('Error loving comment:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // OTHER ENDPOINTS
  // =============================================

  // Save/unsave post
  router.post('/:postId/save', auth, async (req, res) => {
    const { postId } = req.params;
    const { save } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      if (save) {
        await savedPostsCollection.updateOne(
          { postId: postId, userId: userId },
          {
            $set: { postId: postId, userId: userId, savedAt: new Date() },
          },
          { upsert: true },
        );
        await feedCollection.updateOne(
          { _id: new ObjectId(postId) },
          { $inc: { 'stats.saveCount': 1 } },
        );
      } else {
        const result = await savedPostsCollection.deleteOne({
          postId: postId,
          userId: userId,
        });
        if (result.deletedCount > 0) {
          await feedCollection.updateOne(
            { _id: new ObjectId(postId) },
            { $inc: { 'stats.saveCount': -1 } },
          );
        }
      }

      res.send({ message: save ? 'Post saved' : 'Post unsaved', saved: save });
    } catch (error) {
      console.error('Error saving post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get saved posts
  router.get('/saved', auth, async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
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
      const posts = await feedCollection.find({ _id: { $in: postIds } }).toArray();

      const populatedPosts = await populatePostUsers(posts);

      res.send({
        posts: populatedPosts,
        pagination: { page, limit },
      });
    } catch (error) {
      console.error('Error fetching saved posts:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Track post view (for analytics)
  router.post('/:postId/view', async (req, res) => {
    const { postId } = req.params;
    const { watchDuration, completed } = req.body;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    try {
      // Increment view count
      await feedCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { 'stats.viewCount': 1 } },
      );

      // Update engagement metrics if provided
      if (watchDuration !== undefined || completed !== undefined) {
        // This would ideally use a more sophisticated algorithm
        // For now, just increment view count
      }

      res.send({ message: 'View tracked' });
    } catch (error) {
      console.error('Error tracking view:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Report a post
  router.post('/:postId/report', auth, async (req, res) => {
    const { postId } = req.params;
    const { reason } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(postId)) {
      return res.status(400).send({ error: 'Invalid post ID' });
    }

    if (!reason) {
      return res.status(400).send({ error: 'Reason is required' });
    }

    try {
      await db.collection('reports').insertOne({
        postId: postId,
        reportedBy: userId,
        reason: reason,
        status: 'pending',
        createdAt: new Date(),
      });

      res.send({ message: 'Report submitted' });
    } catch (error) {
      console.error('Error reporting post:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  return router;
};
