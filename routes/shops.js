const express = require('express');
const { ObjectId } = require('mongodb');
const escapeRegex = require('../utils/escapeRegex');
const auth = require('../middleware/auth');
const { verifyTokenWithGrace } = require('../middleware/auth');
const {
  fetchPublishedRiderSlugMap,
  enrichShopsTeamRiders,
  enrichShopTeamRiders,
} = require('../services/shops/riderMatcher');

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const COMMENT_MAX_LENGTH = 500;
const COMMENTS_DEFAULT_LIMIT = 20;
const COMMENTS_MAX_LIMIT = 50;
const SPORTS = new Set([
  'skateboarding',
  'snowboarding',
  'skiing',
  'surfing',
  'bmx',
  'mtb',
  'scooter',
  'rollerblading',
  'wakeboarding',
]);
const SERVICES = new Set(['gear', 'apparel', 'repairs', 'rentals', 'lessons', 'online']);

const VALID_RATINGS = new Set([1, 2, 3, 4, 5]);

const optionalUserId = (req) => verifyTokenWithGrace(req.header('x-auth-token'))?.userId || null;

const PUBLIC_SHOP_PROJECTION = {
  name: 1,
  slug: 1,
  description: 1,
  sports: 1,
  services: 1,
  address: 1,
  website: 1,
  phone: 1,
  imageUrl: 1,
  imageAlt: 1,
  imageSourceUrl: 1,
  reviewSummary: 1,
  userRating: 1,
  faqs: 1,
  pressFeatures: 1,
  teamRiders: 1,
  hours: 1,
  socialLinks: 1,
  verified: 1,
  featured: 1,
  updatedAt: 1,
};

function parseListQuery(query) {
  const cursor = Math.max(0, Number.parseInt(query.cursor, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const sport = query.sport && query.sport !== 'all' ? String(query.sport).toLowerCase() : null;
  const service =
    query.service && query.service !== 'all' ? String(query.service).toLowerCase() : null;

  if (sport && !SPORTS.has(sport)) return { error: 'Invalid sport' };
  if (service && !SERVICES.has(service)) return { error: 'Invalid service' };
  return { cursor, limit, sport, service };
}

module.exports = (db) => {
  const router = express.Router();
  const shops = db.collection('shops');
  const shopComments = db.collection('shop_comments');
  const shopRatings = db.collection('shop_ratings');
  const users = db.collection('users');
  const riders = db.collection('riders');

  shops.createIndex({ slug: 1 }, { unique: true, background: true }).catch(() => {});
  shops.createIndex({ status: 1, featured: -1, name: 1 }, { background: true }).catch(() => {});
  // MongoDB cannot maintain a compound index when both fields are arrays.
  // Remove the original empty-collection index and index each filter separately.
  shops.dropIndex('sports_1_services_1').catch(() => {});
  shops.createIndex({ sports: 1 }, { background: true }).catch(() => {});
  shops.createIndex({ services: 1 }, { background: true }).catch(() => {});
  shops.createIndex({ 'address.location': '2dsphere' }, { background: true }).catch(() => {});

  // Shop comments indexes
  shopComments.createIndex({ shopId: 1, createdAt: -1 }, { background: true }).catch(() => {});
  shopComments.createIndex({ parentCommentId: 1 }, { background: true }).catch(() => {});
  shopComments.createIndex({ userId: 1 }, { background: true }).catch(() => {});

  // Shop ratings indexes - unique constraint ensures one rating per user per shop
  shopRatings
    .createIndex({ shopId: 1, userId: 1 }, { unique: true, background: true })
    .catch(() => {});
  shopRatings.createIndex({ shopId: 1 }, { background: true }).catch(() => {});

  async function resolveShop(slugOrId) {
    const or = [{ slug: slugOrId }];
    if (ObjectId.isValid(slugOrId)) or.push({ _id: new ObjectId(slugOrId) });
    return shops.findOne({ status: 'published', $or: or }, { projection: { _id: 1 } });
  }

  async function computeRatingSummary(shopId, userId = null) {
    const ratings = await shopRatings.find({ shopId }).toArray();

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let myRating = null;

    for (const r of ratings) {
      distribution[String(r.rating)]++;
      sum += r.rating;
      if (userId && r.userId === userId) {
        myRating = r.rating;
      }
    }

    const ratingCount = ratings.length;
    const averageRating = ratingCount > 0 ? Math.round((sum / ratingCount) * 10) / 10 : null;

    return { averageRating, ratingCount, distribution, myRating };
  }

  async function updateShopUserRating(shopId) {
    const summary = await computeRatingSummary(shopId);
    await shops.updateOne(
      { _id: new ObjectId(shopId) },
      {
        $set: {
          'userRating.averageRating': summary.averageRating,
          'userRating.ratingCount': summary.ratingCount,
        },
      },
    );
  }

  function ensureUserRating(shop) {
    if (!shop) return shop;
    if (!shop.userRating) {
      shop.userRating = { averageRating: null, ratingCount: 0 };
    }
    return shop;
  }

  function ensureUserRatings(shops) {
    return shops.map(ensureUserRating);
  }

  async function populateCommentUsers(comments) {
    const userIds = [...new Set(comments.map((c) => c.userId))];
    if (userIds.length === 0) return comments;

    const userDocs = await users
      .find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
      .project({ name: 1, imageUri: 1 })
      .toArray();

    const userMap = {};
    userDocs.forEach((u) => {
      userMap[u._id.toString()] = u;
    });

    return comments.map((comment) => ({
      ...comment,
      user: userMap[comment.userId] || { name: 'Unknown' },
    }));
  }

  async function isAdminUser(userId) {
    const user = await users.findOne({ _id: new ObjectId(userId) }, { projection: { role: 1 } });
    return user?.role === 'admin';
  }

  // GET /api/shops - public, filtered, cursor-paginated shop directory.
  router.get('/', async (req, res) => {
    try {
      const parsed = parseListQuery(req.query);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const and = [{ status: 'published' }];
      if (parsed.sport) and.push({ sports: parsed.sport });
      if (parsed.service) and.push({ services: parsed.service });
      if (req.query.q) {
        const rx = { $regex: escapeRegex(String(req.query.q).trim()), $options: 'i' };
        and.push({ $or: [{ name: rx }, { description: rx }, { 'address.city': rx }] });
      }
      if (req.query.location) {
        const rx = { $regex: escapeRegex(String(req.query.location).trim()), $options: 'i' };
        and.push({
          $or: [
            { 'address.city': rx },
            { 'address.region': rx },
            { 'address.postalCode': rx },
            { 'address.country': rx },
          ],
        });
      }

      const filter = { $and: and };
      const [totalCount, docs, riderSlugMap] = await Promise.all([
        shops.countDocuments(filter),
        shops
          .find(filter)
          .project(PUBLIC_SHOP_PROJECTION)
          .sort({ featured: -1, name: 1, _id: 1 })
          .skip(parsed.cursor)
          .limit(parsed.limit)
          .toArray(),
        fetchPublishedRiderSlugMap(riders),
      ]);
      const enrichedShops = ensureUserRatings(enrichShopsTeamRiders(docs, riderSlugMap));
      const nextCursor =
        parsed.cursor + docs.length < totalCount ? String(parsed.cursor + docs.length) : null;

      res.json({ shops: enrichedShops, nextCursor, totalCount });
    } catch (error) {
      console.error('Error listing shops', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /api/shops/:slugOrId - public shop detail.
  router.get('/:slugOrId', async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const or = [{ slug: slugOrId }];
      if (ObjectId.isValid(slugOrId)) or.push({ _id: new ObjectId(slugOrId) });
      const [shop, riderSlugMap] = await Promise.all([
        shops.findOne({ status: 'published', $or: or }, { projection: PUBLIC_SHOP_PROJECTION }),
        fetchPublishedRiderSlugMap(riders),
      ]);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });
      const enrichedShop = ensureUserRating(enrichShopTeamRiders(shop, riderSlugMap));
      res.json({ shop: enrichedShop });
    } catch (error) {
      console.error('Error fetching shop', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // SHOP RATING ENDPOINTS
  // =============================================

  // GET /api/shops/:slugOrId/ratings - public, returns rating summary (myRating if authenticated)
  router.get('/:slugOrId/ratings', async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const userId = optionalUserId(req);

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();
      const summary = await computeRatingSummary(shopId, userId);

      res.json(summary);
    } catch (error) {
      console.error('Error fetching shop ratings', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // PUT /api/shops/:slugOrId/rating - auth required, upsert user's rating
  router.put('/:slugOrId/rating', auth, async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const { rating } = req.body;
      const userId = req.user.userId;

      if (typeof rating !== 'number' || !VALID_RATINGS.has(rating)) {
        return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
      }

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      await shopRatings.updateOne(
        { shopId, userId },
        {
          $set: { rating, updatedAt: new Date() },
          $setOnInsert: { shopId, userId, createdAt: new Date() },
        },
        { upsert: true },
      );

      await updateShopUserRating(shopId);

      const summary = await computeRatingSummary(shopId, userId);
      res.json(summary);
    } catch (error) {
      console.error('Error updating shop rating', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // DELETE /api/shops/:slugOrId/rating - auth required, remove user's rating
  router.delete('/:slugOrId/rating', auth, async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const userId = req.user.userId;

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      await shopRatings.deleteOne({ shopId, userId });

      await updateShopUserRating(shopId);

      const summary = await computeRatingSummary(shopId, userId);
      res.json(summary);
    } catch (error) {
      console.error('Error deleting shop rating', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // =============================================
  // SHOP COMMENT ENDPOINTS
  // =============================================

  // GET /api/shops/:slugOrId/comments - public, paginated, newest-first
  router.get('/:slugOrId/comments', async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(
        parseInt(req.query.limit, 10) || COMMENTS_DEFAULT_LIMIT,
        COMMENTS_MAX_LIMIT,
      );
      const skip = (page - 1) * limit;

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      const comments = await shopComments
        .find({
          shopId: shopId,
          parentCommentId: null,
          status: 'active',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalCount = await shopComments.countDocuments({
        shopId: shopId,
        parentCommentId: null,
        status: 'active',
      });

      const populatedComments = await populateCommentUsers(comments);

      res.json({
        comments: populatedComments,
        pagination: {
          page,
          limit,
          totalCount,
          hasMore: skip + comments.length < totalCount,
        },
      });
    } catch (error) {
      console.error('Error fetching shop comments', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // GET /api/shops/:slugOrId/comments/:commentId/replies - get replies to a comment
  router.get('/:slugOrId/comments/:commentId/replies', async (req, res) => {
    try {
      const { slugOrId, commentId } = req.params;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit, 10) || 10, COMMENTS_MAX_LIMIT);
      const skip = (page - 1) * limit;

      if (!ObjectId.isValid(commentId)) {
        return res.status(400).json({ error: 'Invalid comment ID' });
      }

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      const replies = await shopComments
        .find({
          shopId: shopId,
          parentCommentId: commentId,
          status: 'active',
        })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      const populatedReplies = await populateCommentUsers(replies);

      res.json({
        replies: populatedReplies,
        pagination: { page, limit, hasMore: replies.length === limit },
      });
    } catch (error) {
      console.error('Error fetching comment replies', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // POST /api/shops/:slugOrId/comments - auth required, create comment
  router.post('/:slugOrId/comments', auth, async (req, res) => {
    try {
      const { slugOrId } = req.params;
      const { content, parentCommentId } = req.body;
      const userId = req.user.userId;

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return res.status(400).json({ error: 'Comment cannot be empty' });
      }

      const trimmedContent = content.trim();
      if (trimmedContent.length > COMMENT_MAX_LENGTH) {
        return res.status(400).json({
          error: `Comment too long (max ${COMMENT_MAX_LENGTH} characters)`,
        });
      }

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      if (parentCommentId) {
        if (!ObjectId.isValid(parentCommentId)) {
          return res.status(400).json({ error: 'Invalid parent comment ID' });
        }
        const parentComment = await shopComments.findOne({
          _id: new ObjectId(parentCommentId),
          shopId: shopId,
          status: 'active',
        });
        if (!parentComment) {
          return res.status(404).json({ error: 'Parent comment not found' });
        }
      }

      const comment = {
        shopId: shopId,
        userId: userId,
        parentCommentId: parentCommentId || null,
        content: trimmedContent,
        replyCount: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await shopComments.insertOne(comment);
      comment._id = result.insertedId;

      if (parentCommentId) {
        await shopComments.updateOne(
          { _id: new ObjectId(parentCommentId) },
          { $inc: { replyCount: 1 } },
        );
      }

      const user = await users.findOne(
        { _id: new ObjectId(userId) },
        { projection: { name: 1, imageUri: 1 } },
      );

      const populatedComment = {
        ...comment,
        user: user || { name: 'Unknown' },
      };

      res.status(201).json(populatedComment);
    } catch (error) {
      console.error('Error creating shop comment', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // DELETE /api/shops/:slugOrId/comments/:commentId - auth, author or admin only
  router.delete('/:slugOrId/comments/:commentId', auth, async (req, res) => {
    try {
      const { slugOrId, commentId } = req.params;
      const userId = req.user.userId;

      if (!ObjectId.isValid(commentId)) {
        return res.status(400).json({ error: 'Invalid comment ID' });
      }

      const shop = await resolveShop(slugOrId);
      if (!shop) return res.status(404).json({ error: 'Shop not found' });

      const shopId = shop._id.toString();

      const comment = await shopComments.findOne({
        _id: new ObjectId(commentId),
        shopId: shopId,
      });

      if (!comment) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      if (comment.status === 'deleted') {
        return res.status(404).json({ error: 'Comment not found' });
      }

      const isAdmin = await isAdminUser(userId);
      if (comment.userId !== userId && !isAdmin) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await shopComments.updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { status: 'deleted', updatedAt: new Date() } },
      );

      if (comment.parentCommentId) {
        await shopComments.updateOne(
          { _id: new ObjectId(comment.parentCommentId) },
          { $inc: { replyCount: -1 } },
        );
      }

      res.json({ message: 'Comment deleted' });
    } catch (error) {
      console.error('Error deleting shop comment', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
};

module.exports.PUBLIC_SHOP_PROJECTION = PUBLIC_SHOP_PROJECTION;
module.exports.SERVICES = SERVICES;
module.exports.SPORTS = SPORTS;
