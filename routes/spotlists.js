const express = require('express');
const Joi = require('joi');
const { ObjectId } = require('mongodb');
const validateWith = require('../middleware/validation');
const auth = require('../middleware/auth');
const subscriptionMiddleware = require('../middleware/subscription');

const schema = {
  name: Joi.string().required(),
  description: Joi.string().allow('').optional(),
};

module.exports = (db) => {
  const router = express.Router();
  const spotListsCollection = db.collection('spotlists');
  const spotsCollection = db.collection('spots');
  const trickCollection = db.collection('tricks');

  // Create a new spot list
  router.post(
    '/',
    [auth, subscriptionMiddleware.checkSpotListLimit, validateWith(schema)],
    async (req, res) => {
      const { name, description } = req.body;
      const spotList = {
        name,
        description: description || '',
        userId: req.user.userId,
        spotIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      try {
        const result = await spotListsCollection.insertOne(spotList);
        spotList._id = result.insertedId;
        res.status(201).json(spotList);
      } catch (error) {
        console.error('Error creating spot list', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    },
  );

  // Get user's current usage
  router.get('/usage', [auth], subscriptionMiddleware.getUserUsage);

  // Get all spot lists for the authenticated user
  router.get('/', [auth], async (req, res) => {
    try {
      const spotLists = await spotListsCollection.find({ userId: req.user.userId }).toArray();

      // Add spotCount to each list
      const listsWithCount = spotLists.map((list) => ({
        ...list,
        spotCount: list.spotIds ? list.spotIds.length : 0,
      }));

      res.status(200).json(listsWithCount);
    } catch (error) {
      console.error('Error retrieving spot lists', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Get a single spot list by ID (only if owned by user)
  router.get('/:id', [auth], async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    try {
      const spotList = await spotListsCollection.findOne({
        _id: new ObjectId(id),
        userId: req.user.userId,
      });
      if (!spotList) {
        return res.status(404).json({ error: 'Spot list not found' });
      }
      // Add spotCount and trickCount, include trick data if available
      const listWithCount = {
        ...spotList,
        spotCount: spotList.spotIds ? spotList.spotIds.length : 0,
        trickCount: spotList.trickIds ? spotList.trickIds.length : 0,
      };

      // Populate trick names if trickIds exist
      if (spotList.trickIds && spotList.trickIds.length > 0) {
        const tricks = await trickCollection
          .find({ _id: { $in: spotList.trickIds } })
          .project({ name: 1 })
          .toArray();
        listWithCount.tricks = tricks;
      }

      res.status(200).json(listWithCount);
    } catch (error) {
      console.error('Error retrieving spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Update a spot list (only if owned by user)
  router.put('/:id', [auth, validateWith(schema)], async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    const { name, description } = req.body;
    try {
      const result = await spotListsCollection.updateOne(
        {
          _id: new ObjectId(id),
          userId: req.user.userId,
        },
        {
          $set: {
            name,
            description: description || '',
            updatedAt: new Date(),
          },
        },
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Spot list not found' });
      }
      res.status(200).json({ message: 'Spot list updated successfully' });
    } catch (error) {
      console.error('Error updating spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Delete a spot list (only if owned by user)
  router.delete('/:id', [auth], async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    try {
      const result = await spotListsCollection.deleteOne({
        _id: new ObjectId(id),
        userId: req.user.userId,
      });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Spot list not found' });
      }
      res.status(200).json({ message: 'Spot list deleted successfully' });
    } catch (error) {
      console.error('Error deleting spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Add a spot to a list
  router.post(
    '/:id/spots',
    [auth, subscriptionMiddleware.checkSpotLimit, subscriptionMiddleware.checkTotalSpotsLimit],
    async (req, res) => {
      const listId = req.params.id;
      const { spotId } = req.body;

      if (!ObjectId.isValid(listId)) {
        return res.status(400).json({ error: 'Invalid list ID' });
      }
      if (!ObjectId.isValid(spotId)) {
        return res.status(400).json({ error: 'Invalid spot ID' });
      }

      try {
        // Check if spot exists
        const spot = await spotsCollection.findOne({ _id: new ObjectId(spotId) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        // Add spot to list
        const result = await spotListsCollection.updateOne(
          {
            _id: new ObjectId(listId),
            userId: req.user.userId,
          },
          {
            $addToSet: { spotIds: new ObjectId(spotId) },
            $set: { updatedAt: new Date() },
          },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Spot list not found' });
        }

        res.status(200).json({ message: 'Spot added to list successfully' });
      } catch (error) {
        console.error('Error adding spot to list', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    },
  );

  // Remove a spot from a list
  router.delete('/:id/spots/:spotId', [auth], async (req, res) => {
    const listId = req.params.id;
    const spotId = req.params.spotId;

    if (!ObjectId.isValid(listId)) {
      return res.status(400).json({ error: 'Invalid list ID' });
    }
    if (!ObjectId.isValid(spotId)) {
      return res.status(400).json({ error: 'Invalid spot ID' });
    }

    try {
      const result = await spotListsCollection.updateOne(
        {
          _id: new ObjectId(listId),
          userId: req.user.userId,
        },
        {
          $pull: { spotIds: new ObjectId(spotId) },
          $set: { updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Spot list not found' });
      }

      res.status(200).json({ message: 'Spot removed from list successfully' });
    } catch (error) {
      console.error('Error removing spot from list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Add a trick to a spotlist (for "tricks to do at these spots" planning)
  router.post('/:id/tricks', [auth], async (req, res) => {
    const listId = req.params.id;
    const { trickId } = req.body;

    if (!ObjectId.isValid(listId)) {
      return res.status(400).json({ error: 'Invalid list ID' });
    }
    if (!ObjectId.isValid(trickId)) {
      return res.status(400).json({ error: 'Invalid trick ID' });
    }

    try {
      const trick = await trickCollection.findOne({ _id: new ObjectId(trickId) });
      if (!trick) {
        return res.status(404).json({ error: 'Trick not found' });
      }

      const result = await spotListsCollection.updateOne(
        { _id: new ObjectId(listId), userId: req.user.userId },
        {
          $addToSet: { trickIds: new ObjectId(trickId) },
          $set: { updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Spot list not found' });
      }

      res.status(200).json({ message: 'Trick added to spot list successfully' });
    } catch (error) {
      console.error('Error adding trick to spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Remove a trick from a spotlist
  router.delete('/:id/tricks/:trickId', [auth], async (req, res) => {
    const listId = req.params.id;
    const trickId = req.params.trickId;

    if (!ObjectId.isValid(listId)) {
      return res.status(400).json({ error: 'Invalid list ID' });
    }
    if (!ObjectId.isValid(trickId)) {
      return res.status(400).json({ error: 'Invalid trick ID' });
    }

    try {
      const result = await spotListsCollection.updateOne(
        { _id: new ObjectId(listId), userId: req.user.userId },
        {
          $pull: { trickIds: new ObjectId(trickId) },
          $set: { updatedAt: new Date() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Spot list not found' });
      }

      res.status(200).json({ message: 'Trick removed from spot list successfully' });
    } catch (error) {
      console.error('Error removing trick from spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Get tricks in a spotlist
  router.get('/:id/tricks', [auth], async (req, res) => {
    const listId = req.params.id;

    if (!ObjectId.isValid(listId)) {
      return res.status(400).json({ error: 'Invalid list ID' });
    }

    try {
      const spotList = await spotListsCollection.findOne({
        _id: new ObjectId(listId),
        userId: req.user.userId,
      });

      if (!spotList) {
        return res.status(404).json({ error: 'Spot list not found' });
      }

      if (!spotList.trickIds || spotList.trickIds.length === 0) {
        return res.status(200).json([]);
      }

      const tricks = await trickCollection.find({ _id: { $in: spotList.trickIds } }).toArray();
      res.status(200).json(tricks);
    } catch (error) {
      console.error('Error retrieving tricks in spot list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Get all spots in a list
  router.get('/:id/spots', [auth], async (req, res) => {
    const listId = req.params.id;

    if (!ObjectId.isValid(listId)) {
      return res.status(400).json({ error: 'Invalid list ID' });
    }

    try {
      const spotList = await spotListsCollection.findOne({
        _id: new ObjectId(listId),
        userId: req.user.userId,
      });

      if (!spotList) {
        return res.status(404).json({ error: 'Spot list not found' });
      }

      // Get all spots in the list
      const spots = await spotsCollection.find({ _id: { $in: spotList.spotIds } }).toArray();

      res.status(200).json(spots);
    } catch (error) {
      console.error('Error retrieving spots in list', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  return router;
};
