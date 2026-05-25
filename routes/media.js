/**
 * Media Routes - "The Couch" Library API
 * Handles curated action sports films, documentaries, and edits
 */

const express = require('express');
const auth = require('../middleware/auth');
const escapeRegex = require('../utils/escapeRegex');
const ObjectId = require('mongodb').ObjectId;

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

// Content types enum
const CONTENT_TYPES = ['film', 'documentary', 'series', 'edit', 'tutorial', 'competition'];

module.exports = (db) => {
  const router = express.Router();
  const mediaCollection = db.collection('media_library');
  const collectionsCollection = db.collection('media_collections');
  const ratingsCollection = db.collection('media_ratings');

  // =============================================
  // LIBRARY ENDPOINTS
  // =============================================

  // Get paginated library content
  router.get('/library', async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const skip = (page - 1) * limit;
      const sport = req.query.sport;
      const type = req.query.type;
      const search = req.query.search;

      // Build query
      const query = { status: 'published' };

      if (sport && sport !== 'all' && SPORT_TYPES.includes(sport)) {
        query.sportTypes = sport;
      }

      if (type && type !== 'all' && CONTENT_TYPES.includes(type)) {
        query.type = type;
      }

      if (search) {
        query.$text = { $search: search };
      }

      const [media, total] = await Promise.all([
        mediaCollection
          .find(query)
          .sort({ publishedAt: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        mediaCollection.countDocuments(query),
      ]);

      res.send({
        media,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('Error fetching library:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get single video details
  router.get('/library/:id', async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const video = await mediaCollection.findOne({
        _id: new ObjectId(id),
        status: 'published',
      });

      if (!video) {
        return res.status(404).send({ error: 'Video not found' });
      }

      res.send(video);
    } catch (error) {
      console.error('Error fetching video:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get featured content for hero section
  router.get('/featured', async (_req, res) => {
    try {
      const featured = await mediaCollection.findOne({
        status: 'published',
        featured: true,
      });

      if (!featured) {
        // Return most recent if no featured
        const recent = await mediaCollection.findOne(
          { status: 'published' },
          { sort: { publishedAt: -1 } },
        );
        return res.send(recent);
      }

      res.send(featured);
    } catch (error) {
      console.error('Error fetching featured:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get all collections
  router.get('/collections', async (req, res) => {
    try {
      const sport = req.query.sport;
      const query = {};

      if (sport && sport !== 'all' && SPORT_TYPES.includes(sport)) {
        query.sportType = sport;
      }

      const collections = await collectionsCollection
        .find(query)
        .sort({ featured: -1, createdAt: -1 })
        .toArray();

      // Populate videos for each collection
      const populatedCollections = await Promise.all(
        collections.map(async (collection) => {
          if (collection.mediaIds && collection.mediaIds.length > 0) {
            const mediaIds = collection.mediaIds.map((id) => new ObjectId(id));
            const videos = await mediaCollection
              .find({
                _id: { $in: mediaIds },
                status: 'published',
              })
              .limit(10)
              .toArray();
            return { ...collection, videos };
          }
          return { ...collection, videos: [] };
        }),
      );

      res.send(populatedCollections);
    } catch (error) {
      console.error('Error fetching collections:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get single collection with videos
  router.get('/collections/:id', async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const collection = await collectionsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!collection) {
        return res.status(404).send({ error: 'Collection not found' });
      }

      // Populate videos
      if (collection.mediaIds && collection.mediaIds.length > 0) {
        const mediaIds = collection.mediaIds.map((mid) => new ObjectId(mid));
        const videos = await mediaCollection
          .find({
            _id: { $in: mediaIds },
            status: 'published',
          })
          .toArray();
        collection.videos = videos;
      } else {
        collection.videos = [];
      }

      res.send(collection);
    } catch (error) {
      console.error('Error fetching collection:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Search library content
  router.get('/search', async (req, res) => {
    try {
      const q = req.query.q;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const skip = (page - 1) * limit;
      const sport = req.query.sport;
      const type = req.query.type;

      if (!q || q.trim().length < 2) {
        return res.status(400).send({ error: 'Search query too short' });
      }

      const query = {
        status: 'published',
        $or: [
          { title: { $regex: escapeRegex(q), $options: 'i' } },
          { description: { $regex: escapeRegex(q), $options: 'i' } },
          { tags: { $regex: escapeRegex(q), $options: 'i' } },
          { 'athletes.name': { $regex: escapeRegex(q), $options: 'i' } },
        ],
      };

      if (sport && sport !== 'all' && SPORT_TYPES.includes(sport)) {
        query.sportTypes = sport;
      }

      if (type && type !== 'all' && CONTENT_TYPES.includes(type)) {
        query.type = type;
      }

      const [results, total] = await Promise.all([
        mediaCollection.find(query).skip(skip).limit(limit).toArray(),
        mediaCollection.countDocuments(query),
      ]);

      res.send({
        results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('Error searching library:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Rate a video (1-5 stars) - requires auth
  router.post('/library/:id/rate', auth, async (req, res) => {
    const { id } = req.params;
    const { rating } = req.body;
    const userId = req.user.userId;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).send({ error: 'Rating must be between 1 and 5' });
    }

    try {
      // Check if user already rated
      const existingRating = await ratingsCollection.findOne({
        mediaId: id,
        userId: userId,
      });

      if (existingRating) {
        // Update existing rating
        const oldRating = existingRating.rating;
        await ratingsCollection.updateOne(
          { _id: existingRating._id },
          { $set: { rating: rating, updatedAt: new Date() } },
        );

        // Update media average (subtract old, add new)
        await mediaCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { totalRatingSum: rating - oldRating },
          },
        );
      } else {
        // Create new rating
        await ratingsCollection.insertOne({
          mediaId: id,
          userId: userId,
          rating: rating,
          createdAt: new Date(),
        });

        // Update media stats
        await mediaCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: {
              ratingCount: 1,
              totalRatingSum: rating,
            },
          },
        );
      }

      // Recalculate average
      const media = await mediaCollection.findOne({ _id: new ObjectId(id) });
      const avgRating = media.ratingCount > 0 ? media.totalRatingSum / media.ratingCount : 0;

      await mediaCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { avgRating: avgRating } },
      );

      res.send({ message: 'Rating saved', avgRating });
    } catch (error) {
      console.error('Error rating video:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Track video view
  router.post('/library/:id/view', async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      await mediaCollection.updateOne({ _id: new ObjectId(id) }, { $inc: { viewCount: 1 } });

      res.send({ message: 'View tracked' });
    } catch (error) {
      console.error('Error tracking view:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get related videos
  router.get('/library/:id/related', async (req, res) => {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const video = await mediaCollection.findOne({ _id: new ObjectId(id) });

      if (!video) {
        return res.status(404).send({ error: 'Video not found' });
      }

      // Find related by sport types and tags
      const related = await mediaCollection
        .find({
          _id: { $ne: new ObjectId(id) },
          status: 'published',
          $or: [
            { sportTypes: { $in: video.sportTypes || [] } },
            { tags: { $in: video.tags || [] } },
            { type: video.type },
          ],
        })
        .sort({ avgRating: -1, viewCount: -1 })
        .limit(limit)
        .toArray();

      res.send(related);
    } catch (error) {
      console.error('Error fetching related videos:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Get content by sport type
  router.get('/library/sport/:sportType', async (req, res) => {
    const { sportType } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;

    if (!SPORT_TYPES.includes(sportType)) {
      return res.status(400).send({ error: 'Invalid sport type' });
    }

    try {
      const query = {
        status: 'published',
        sportTypes: sportType,
      };

      const [media, total] = await Promise.all([
        mediaCollection.find(query).sort({ publishedAt: -1 }).skip(skip).limit(limit).toArray(),
        mediaCollection.countDocuments(query),
      ]);

      res.send({
        media,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('Error fetching content by sport:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // ADMIN ENDPOINTS (Add content to library)
  // =============================================

  // Create new media entry (admin only - add admin middleware later)
  router.post('/library', auth, async (req, res) => {
    const {
      title,
      description,
      type,
      sportTypes,
      duration,
      releaseYear,
      bunnyVideoId,
      hlsUrl,
      thumbnails,
      athletes,
      filmmakers,
      productionCompany,
      location,
      tags,
      difficulty,
      tmdbId,
      imdbId,
    } = req.body;

    if (!title || !type) {
      return res.status(400).send({ error: 'Title and type are required' });
    }

    if (!CONTENT_TYPES.includes(type)) {
      return res.status(400).send({ error: 'Invalid content type' });
    }

    try {
      const media = {
        title,
        description: description || '',
        type,
        sportTypes: sportTypes || [],
        duration: duration || null,
        releaseYear: releaseYear || null,
        bunnyVideoId: bunnyVideoId || null,
        hlsUrl: hlsUrl || null,
        thumbnails: thumbnails || {},
        athletes: athletes || [],
        filmmakers: filmmakers || [],
        productionCompany: productionCompany || null,
        location: location || null,
        tags: tags || [],
        difficulty: difficulty || null,
        tmdbId: tmdbId || null,
        imdbId: imdbId || null,
        collections: [],
        viewCount: 0,
        avgRating: 0,
        ratingCount: 0,
        totalRatingSum: 0,
        status: 'draft',
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await mediaCollection.insertOne(media);
      media._id = result.insertedId;

      res.status(201).send(media);
    } catch (error) {
      console.error('Error creating media:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Update media entry
  router.put('/library/:id', auth, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const updates = { ...req.body, updatedAt: new Date() };
      delete updates._id; // Don't update _id

      const result = await mediaCollection.updateOne({ _id: new ObjectId(id) }, { $set: updates });

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: 'Media not found' });
      }

      const updated = await mediaCollection.findOne({ _id: new ObjectId(id) });
      res.send(updated);
    } catch (error) {
      console.error('Error updating media:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Delete media entry
  router.delete('/library/:id', auth, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }

    try {
      const result = await mediaCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).send({ error: 'Media not found' });
      }

      // Also delete ratings
      await ratingsCollection.deleteMany({ mediaId: id });

      res.send({ message: 'Media deleted' });
    } catch (error) {
      console.error('Error deleting media:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Create collection
  router.post('/collections', auth, async (req, res) => {
    const { name, description, coverImage, sportType, mediaIds } = req.body;

    if (!name) {
      return res.status(400).send({ error: 'Collection name is required' });
    }

    try {
      const collection = {
        name,
        description: description || '',
        coverImage: coverImage || null,
        sportType: sportType || null,
        mediaIds: mediaIds || [],
        curatedBy: 'editorial',
        featured: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await collectionsCollection.insertOne(collection);
      collection._id = result.insertedId;

      res.status(201).send(collection);
    } catch (error) {
      console.error('Error creating collection:', error);
      res.status(500).send({ error: 'Internal Server Error' });
    }
  });

  return router;
};
