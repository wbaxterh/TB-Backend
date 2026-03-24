/**
 * Spot Trick History Route
 * Famous tricks done at spots — user submitted + curated
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { MongoClient, ObjectId } = require('mongodb');

const connectionString = process.env.ATLAS_URI;
let db;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then(client => {
    db = client.db('TrickList2');
    console.log('SpotTrickHistory: Connected to MongoDB');
  })
  .catch(err => console.error('SpotTrickHistory DB error:', err));

function col() { return db.collection('spot_trick_history'); }

// GET /api/spot-tricks/:spotId — trick history for a spot
router.get('/:spotId', async (req, res) => {
  try {
    const { spotId } = req.params;
    const { sort = 'year', page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = sort === 'upvotes' ? { upvotes: -1 } : { year: -1, createdAt: -1 };

    const [tricks, total] = await Promise.all([
      col().find({ spotId: new ObjectId(spotId) }).sort(sortObj).skip(skip).limit(parseInt(limit)).toArray(),
      col().countDocuments({ spotId: new ObjectId(spotId) })
    ]);

    res.json({ tricks, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('GET spot-tricks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/spot-tricks/skater/:skaterName — all tricks by a skater
router.get('/skater/:skaterName', async (req, res) => {
  try {
    const { skaterName } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { skaterName: { $regex: new RegExp(skaterName, 'i') } };

    const [tricks, total] = await Promise.all([
      col().find(query).sort({ year: -1 }).skip(skip).limit(parseInt(limit)).toArray(),
      col().countDocuments(query)
    ]);

    res.json({ tricks, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('GET skater tricks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spot-tricks — submit a trick (auth required)
router.post('/', auth, async (req, res) => {
  try {
    const { spotId, trickName, skaterName, videoUrl, thumbnailUrl, description, year, source, sourceUrl } = req.body;
    if (!spotId || !trickName || !skaterName) {
      return res.status(400).json({ error: 'spotId, trickName, and skaterName are required' });
    }

    const trick = {
      spotId: new ObjectId(spotId),
      trickName,
      skaterName,
      videoUrl: videoUrl || null,
      thumbnailUrl: thumbnailUrl || null,
      source: source || 'user_submitted',
      sourceUrl: sourceUrl || null,
      year: year ? parseInt(year) : null,
      description: description || null,
      userId: req.user.userId,
      verified: req.user.role === 'admin',
      upvotes: 0,
      upvotedBy: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await col().insertOne(trick);
    res.status(201).json({ ...trick, _id: result.insertedId });
  } catch (err) {
    console.error('POST spot-trick error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/spot-tricks/:id/verify — admin verify
router.put('/:id/verify', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const result = await col().findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { verified: true, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result.value && !result) return res.status(404).json({ error: 'Not found' });
    res.json(result.value || result);
  } catch (err) {
    console.error('PUT verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/spot-tricks/:id/upvote — upvote (auth required)
router.post('/:id/upvote', auth, async (req, res) => {
  try {
    const trickId = new ObjectId(req.params.id);
    const userId = req.user.userId;
    const trick = await col().findOne({ _id: trickId });
    if (!trick) return res.status(404).json({ error: 'Not found' });

    const alreadyUpvoted = (trick.upvotedBy || []).includes(userId);
    const update = alreadyUpvoted
      ? { $inc: { upvotes: -1 }, $pull: { upvotedBy: userId }, $set: { updatedAt: new Date() } }
      : { $inc: { upvotes: 1 }, $addToSet: { upvotedBy: userId }, $set: { updatedAt: new Date() } };

    await col().updateOne({ _id: trickId }, update);
    const updated = await col().findOne({ _id: trickId });
    res.json({ upvotes: updated.upvotes, upvoted: !alreadyUpvoted });
  } catch (err) {
    console.error('POST upvote error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/spot-tricks/:id — delete (owner or admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const trick = await col().findOne({ _id: new ObjectId(req.params.id) });
    if (!trick) return res.status(404).json({ error: 'Not found' });
    if (trick.userId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await col().deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('DELETE trick error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
