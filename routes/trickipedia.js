const express = require('express');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const escapeRegex = require('../utils/escapeRegex');

const EDGE_STATUSES = new Set(['draft', 'reviewed', 'published', 'disputed']);
const EDGE_CONFIDENCE = new Set(['high', 'medium', 'low']);
const EDGE_STRENGTHS = new Set(['required', 'recommended', 'helpful']);
const RELATION_TYPES = new Set([
  'variation',
  'opposite-direction',
  'same-family',
  'combination',
  'terrain-transfer',
]);

const optionalArray = (value, field) => {
  if (value == null) return null;
  return Array.isArray(value) ? null : `${field} must be an array`;
};

const validateEdges = (edges, field, { strength = false, relation = false } = {}) => {
  const arrayError = optionalArray(edges, field);
  if (arrayError) return arrayError;
  for (const edge of edges || []) {
    if (!edge || !ObjectId.isValid(edge.trickId)) return `${field}.trickId must be a valid ID`;
    if (typeof edge.reason !== 'string' || !edge.reason.trim()) {
      return `${field}.reason is required`;
    }
    if (strength && edge.strength && !EDGE_STRENGTHS.has(edge.strength)) {
      return `${field}.strength is invalid`;
    }
    if (relation && !RELATION_TYPES.has(edge.relation)) return `${field}.relation is invalid`;
    const research = edge.research;
    if (research?.status && !EDGE_STATUSES.has(research.status)) {
      return `${field}.research.status is invalid`;
    }
    if (research?.confidence && !EDGE_CONFIDENCE.has(research.confidence)) {
      return `${field}.research.confidence is invalid`;
    }
    if (research?.evidence && !Array.isArray(research.evidence)) {
      return `${field}.research.evidence must be an array`;
    }
  }
  return null;
};

const validateProgression = (progression) => {
  if (progression == null) return null;
  if (typeof progression !== 'object' || Array.isArray(progression)) {
    return 'progression must be an object';
  }
  return (
    validateEdges(progression.prerequisites, 'progression.prerequisites', { strength: true }) ||
    validateEdges(progression.nextSteps, 'progression.nextSteps') ||
    validateEdges(progression.related, 'progression.related', { relation: true })
  );
};

const validateTutorials = (tutorials) => {
  const arrayError = optionalArray(tutorials, 'tutorials');
  if (arrayError) return arrayError;
  for (const tutorial of tutorials || []) {
    if (!tutorial?.canonicalUrl || typeof tutorial.canonicalUrl !== 'string') {
      return 'tutorials.canonicalUrl is required';
    }
    if (!tutorial.platform || typeof tutorial.platform !== 'string') {
      return 'tutorials.platform is required';
    }
    if (tutorial.instructor?.isProfessional && !tutorial.instructor.credentialSourceUrl) {
      return 'professional tutorials require instructor.credentialSourceUrl';
    }
  }
  return null;
};

const normalizeResearch = (research) => ({
  status: research?.status || 'draft',
  confidence: research?.confidence || 'low',
  evidence: (research?.evidence || []).map((item) => ({
    ...item,
    checkedAt: item.checkedAt ? new Date(item.checkedAt) : new Date(),
  })),
  reviewedBy: research?.reviewedBy || null,
  reviewedAt: research?.reviewedAt ? new Date(research.reviewedAt) : null,
});

const normalizeProgression = (progression = {}) => ({
  prerequisites: (progression.prerequisites || []).map((edge, order) => ({
    ...edge,
    trickId: new ObjectId(edge.trickId),
    strength: edge.strength || 'helpful',
    order: edge.order ?? order,
    research: normalizeResearch(edge.research),
  })),
  nextSteps: (progression.nextSteps || []).map((edge, order) => ({
    ...edge,
    trickId: new ObjectId(edge.trickId),
    order: edge.order ?? order,
    research: normalizeResearch(edge.research),
  })),
  related: (progression.related || []).map((edge) => ({
    ...edge,
    trickId: new ObjectId(edge.trickId),
    research: normalizeResearch(edge.research),
  })),
});

const normalizeTutorials = (tutorials = []) =>
  tutorials.map((tutorial) => ({
    ...tutorial,
    availability: tutorial.availability || 'active',
    embedAllowed: tutorial.embedAllowed !== false,
    featured: tutorial.featured === true,
    lastVerifiedAt: tutorial.lastVerifiedAt ? new Date(tutorial.lastVerifiedAt) : new Date(),
    transcript: {
      status: tutorial.transcript?.status || 'pending',
      ...tutorial.transcript,
      retrievedAt: tutorial.transcript?.retrievedAt
        ? new Date(tutorial.transcript.retrievedAt)
        : null,
    },
  }));

const writableFields = (body) => ({
  name: body.name,
  category: body.category,
  difficulty: body.difficulty,
  description: body.description,
  steps: body.steps,
  tips: body.tips || [],
  commonMistakes: body.commonMistakes || [],
  safety: body.safety || [],
  aliases: body.aliases || [],
  images: body.images || [],
  videoUrl: body.videoUrl || null,
  videos: body.videos || [],
  tutorials: normalizeTutorials(body.tutorials),
  progression: normalizeProgression(body.progression),
  source: body.source || null,
  audit: body.audit || null,
});

// Utility function to generate a URL slug from the trick name
const generateSlug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

// Validation function for trick data
const validateTrick = (trick) => {
  const requiredFields = ['name', 'category', 'difficulty', 'description', 'steps'];
  const missingFields = requiredFields.filter((field) => !trick[field]);

  if (missingFields.length > 0) {
    return {
      isValid: false,
      message: `Missing required fields: ${missingFields.join(', ')}`,
    };
  }

  // Validate data types
  if (typeof trick.name !== 'string') return { isValid: false, message: 'Name must be a string' };
  if (typeof trick.category !== 'string')
    return { isValid: false, message: 'Category must be a string' };
  if (typeof trick.difficulty !== 'string')
    return { isValid: false, message: 'Difficulty must be a string' };
  if (typeof trick.description !== 'string')
    return { isValid: false, message: 'Description must be a string' };
  if (!Array.isArray(trick.steps)) return { isValid: false, message: 'Steps must be an array' };
  if (trick.images && !Array.isArray(trick.images))
    return { isValid: false, message: 'Images must be an array' };
  if (trick.videoUrl && typeof trick.videoUrl !== 'string')
    return { isValid: false, message: 'Video URL must be a string' };
  if (trick.videos && !Array.isArray(trick.videos))
    return { isValid: false, message: 'Videos must be an array' };
  if (trick.source && typeof trick.source !== 'string')
    return { isValid: false, message: 'Source must be a string' };
  if (trick.url && typeof trick.url !== 'string')
    return { isValid: false, message: 'URL must be a string' };

  const progressionError = validateProgression(trick.progression);
  if (progressionError) return { isValid: false, message: progressionError };
  const tutorialsError = validateTutorials(trick.tutorials);
  if (tutorialsError) return { isValid: false, message: tutorialsError };

  return { isValid: true };
};

module.exports = (db) => {
  const router = express.Router();
  console.log('Connected to Database');
  const trickipediaCollection = db.collection('trickipedia');

  // Get all tricks with optional filtering
  router.get('/', async (req, res) => {
    try {
      const { category, difficulty, search, sportType } = req.query;
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 250);
      const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
      const query = {};

      if (category) query.category = category;
      if (sportType) query.$and = [{ $or: [{ sportTypes: sportType }, { category: sportType }] }];
      if (difficulty) query.difficulty = difficulty;
      if (search) {
        const searchClause = {
          $or: [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { description: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        };
        query.$and = [...(query.$and || []), searchClause];
      }

      const tricks = await trickipediaCollection
        .find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.json(tricks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching tricks' });
    }
  });

  router.get('/url/:slug', async (req, res) => {
    try {
      const trick = await trickipediaCollection.findOne({ url: req.params.slug });
      if (!trick) return res.status(404).json({ message: 'Trick not found' });
      res.json(trick);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching trick' });
    }
  });

  router.get('/:id/network', async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid trick ID' });
      }
      const trick = await trickipediaCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!trick) return res.status(404).json({ message: 'Trick not found' });

      const visible = (edge) => ['reviewed', 'published'].includes(edge.research?.status);
      const groups = {
        foundations: (trick.progression?.prerequisites || []).filter(visible),
        nextSteps: (trick.progression?.nextSteps || []).filter(visible),
        related: (trick.progression?.related || []).filter(visible),
      };
      const ids = [
        ...new Set(
          Object.values(groups)
            .flat()
            .map((edge) => edge.trickId.toString()),
        ),
      ].map((id) => new ObjectId(id));
      const linked = ids.length
        ? await trickipediaCollection
            .find({ _id: { $in: ids } })
            .project({ name: 1, url: 1, category: 1, difficulty: 1, images: 1 })
            .toArray()
        : [];
      const linkedById = new Map(linked.map((item) => [item._id.toString(), item]));
      const hydrate = (edges) =>
        edges
          .map((edge) => ({ ...edge, trick: linkedById.get(edge.trickId.toString()) }))
          .filter((edge) => edge.trick)
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      const tutorials = (trick.tutorials || []).filter(
        (tutorial) => tutorial.availability === 'active',
      );
      res.json({
        trick: { _id: trick._id, name: trick.name, url: trick.url, category: trick.category },
        foundations: hydrate(groups.foundations),
        nextSteps: hydrate(groups.nextSteps),
        related: hydrate(groups.related),
        featuredTutorial: tutorials.find((tutorial) => tutorial.featured) || tutorials[0] || null,
        alternateTutorials: tutorials.filter((tutorial) => !tutorial.featured),
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching trick network' });
    }
  });

  // Get tricks by category
  router.get('/category/:category', async (req, res) => {
    try {
      const { category } = req.params;
      const { difficulty, search } = req.query;
      const query = { category };

      if (difficulty) query.difficulty = difficulty;
      if (search) {
        query.$or = [
          { name: { $regex: escapeRegex(search), $options: 'i' } },
          { description: { $regex: escapeRegex(search), $options: 'i' } },
        ];
      }

      const tricks = await trickipediaCollection.find(query).sort({ name: 1 }).toArray();

      if (tricks.length === 0) {
        return res.status(404).json({
          message: `No tricks found in category: ${category}`,
          category: category,
        });
      }

      res.json({
        category: category,
        count: tricks.length,
        tricks: tricks,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching tricks by category' });
    }
  });

  // Get a single trick by ID
  router.get('/:id', async (req, res) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid trick ID' });
      }

      const trick = await trickipediaCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!trick) {
        return res.status(404).json({ message: 'Trick not found' });
      }

      res.json(trick);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error fetching trick' });
    }
  });

  // Create a new trick (admin only)
  router.post('/', auth, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const validation = validateTrick(req.body);
      if (!validation.isValid) {
        return res.status(400).json({ message: validation.message });
      }

      const url = generateSlug(req.body.name);
      const trick = {
        ...writableFields(req.body),
        url,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await trickipediaCollection.insertOne(trick);
      trick._id = result.insertedId;

      res.status(201).json(trick);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error creating trick' });
    }
  });

  // Update a trick (admin only)
  router.put('/:id', auth, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid trick ID' });
      }

      const validation = validateTrick(req.body);
      if (!validation.isValid) {
        return res.status(400).json({ message: validation.message });
      }

      const url = generateSlug(req.body.name);
      const update = {
        ...writableFields(req.body),
        url,
        updatedAt: new Date(),
      };

      const result = await trickipediaCollection.findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: update },
        { returnDocument: 'after' },
      );

      if (!result.value) {
        return res.status(404).json({ message: 'Trick not found' });
      }

      res.json(result.value);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error updating trick' });
    }
  });

  // Delete a trick (admin only)
  router.delete('/:id', auth, async (req, res) => {
    try {
      // Check if user is admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (!ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid trick ID' });
      }

      const result = await trickipediaCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: 'Trick not found' });
      }

      res.json({ message: 'Trick deleted successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error deleting trick' });
    }
  });

  return router;
};
