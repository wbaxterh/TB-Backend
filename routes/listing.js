//This is the route for CRUD on a Trick
const express = require('express');

const _store = require('../store/listings');
const auth = require('../middleware/auth');
const authAdmin = require('../middleware/authAdmin');
const _listingMapper = require('../mappers/listings');

const ObjectId = require('mongodb').ObjectId;

module.exports = (db) => {
  const router = express.Router();
  // console.log('Connected to Database')
  const tricksCollection = db.collection('tricklists');
  const trickCollection = db.collection('tricks');
  const spotsCollection = db.collection('spots');
  const _trick_id = '';

  // Ownership helpers. A trick's owner is the owner of the tricklist that
  // contains it (tricklists.user.$id, stored as the string userId — the same
  // value the JWT carries and existing GET queries match on). String-compared
  // so a legacy ObjectId-typed $id still resolves.
  const isAdmin = (req) => req.user?.role === 'admin';
  const userOwnsTrickList = async (listId, userId) => {
    if (!ObjectId.isValid(listId)) return false;
    const list = await tricksCollection.findOne({ _id: new ObjectId(listId) });
    return !!list && String(list.user?.$id) === String(userId);
  };
  const userOwnsTrick = async (trickId, userId) => {
    if (!ObjectId.isValid(trickId)) return false;
    const list = await tricksCollection.findOne({ 'tricks._id': new ObjectId(trickId) });
    return !!list && String(list.user?.$id) === String(userId);
  };

  // Helper: populate spot data for tricks that have spotId
  const populateSpotData = async (tricks) => {
    const spotIds = tricks.filter((t) => t.spotId).map((t) => new ObjectId(t.spotId));
    if (spotIds.length === 0) return tricks;

    const spots = await spotsCollection
      .find({ _id: { $in: spotIds } })
      .project({ name: 1, city: 1, state: 1 })
      .toArray();
    const spotMap = {};
    spots.forEach((s) => {
      spotMap[s._id.toString()] = s;
    });

    return tricks.map((t) => {
      if (t.spotId && spotMap[t.spotId.toString()]) {
        return { ...t, spot: spotMap[t.spotId.toString()] };
      }
      return t;
    });
  };

  router.get('/', async (req, res) => {
    db.collection('tricks')
      .find({ list_id: req.query.list_id })
      .toArray()
      .then(async (results) => {
        const populated = await populateSpotData(results);
        res.send(populated);
      })
      .catch((error) => console.error(error));
  });

  // Admin-only + paginated. Previously unauthenticated and dumped the entire
  // tricks collection (every user's private trick data) on every call.
  router.get('/allData', authAdmin(), async (req, res) => {
    try {
      const page = Math.max(0, Number.parseInt(req.query.page, 10) || 0);
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
      const [items, total] = await Promise.all([
        trickCollection
          .find()
          .sort({ createdAt: -1 })
          .skip(page * limit)
          .limit(limit)
          .toArray(),
        trickCollection.countDocuments(),
      ]);
      res.status(200).send({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) {
      res.status(500).send(error);
    }
  });

  router.get('/allTricks', async (req, res) => {
    try {
      const tricklists = await tricksCollection.find({ 'user.$id': req.query.userId }).toArray();
      const trickIds = tricklists.flatMap((tricklist) =>
        tricklist.tricks.map((trick) => new ObjectId(trick._id)),
      );
      const totalTricks = trickIds.length;
      res.send({ totalTricks: totalTricks });
    } catch (error) {
      res.status(500).send(error);
    }
  });

  //data for graph
  router.get('/graph', authAdmin(), async (_req, res) => {
    try {
      const results = await trickCollection
        .aggregate([
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              date: {
                $dateFromParts: {
                  year: '$_id.year',
                  month: '$_id.month',
                  day: '$_id.day',
                },
              },
              count: 1,
            },
          },
        ])
        .toArray();

      const data = {
        labels: [],
        datasets: [
          {
            data: [],
            color: (opacity = 1) => `rgba(0, 0, 255, ${opacity})`,
          },
        ],
      };

      results.forEach(({ date, count }) => {
        data.labels.push(date.toISOString().slice(0, 10));
        data.datasets[0].data.push(count);
      });

      res.send(data);
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: 'Error getting graph data' });
    }
  });

  router.delete('/:id', auth, async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }
    if (!isAdmin(req) && !(await userOwnsTrick(id, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    const result = await db.collection('tricks').deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).send({ error: 'Document not found' });
    } else {
      const _result2 = db.collection('tricklists').updateMany(
        {},
        {
          $pull: {
            tricks: { _id: new ObjectId(id) },
          },
        },
      );
      return res.send({ message: 'Document deleted successfully' });
    }
  });

  router.put('/edit', auth, async (req, res) => {
    if (!isAdmin(req) && !(await userOwnsTrick(req.body.trickId, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    const filter3 = { _id: new ObjectId(req.body.trickId) };
    const setFields = {
      name: req.body.name,
      link: req.body.link,
      notes: req.body.notes,
      updatedAt: new Date(),
    };
    // Accept optional spotId and videoUrl
    if (req.body.spotId !== undefined) {
      setFields.spotId = req.body.spotId ? req.body.spotId : null;
    }
    if (req.body.videoUrl !== undefined) {
      setFields.videoUrl = req.body.videoUrl || null;
    }
    if (req.body.feedPostId !== undefined) {
      setFields.feedPostId = req.body.feedPostId || null;
    }
    const update2 = { $set: setFields };
    try {
      const _updateResult = await trickCollection.findOneAndUpdate(filter3, update2);
      return res.status(200).send('Success!');
    } catch (error) {
      console.log(error);
      return res.status(400).send(error);
    }
  });

  router.put('/update', auth, async (req, res) => {
    if (!isAdmin(req) && !(await userOwnsTrick(req.body._id, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    const filter2 = { _id: new ObjectId(req.body._id) };
    const update = { $set: { checked: req.body.checked, updatedAt: new Date() } };
    try {
      const _updateResult = await trickCollection.findOneAndUpdate(filter2, update);
      return res.status(200).send('Success!');
    } catch (error) {
      console.log(error);
      return res.status(400).send(error);
    }
  });

  router.put('/', auth, async (req, res) => {
    if (!isAdmin(req) && !(await userOwnsTrickList(req.body.list_id, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    try {
      const trickDocument = {
        ...req.body,
        createdAt: new Date(),
      };
      // Preserve optional spotId and videoUrl if provided
      if (req.body.spotId) {
        trickDocument.spotId = req.body.spotId;
      }
      if (req.body.videoUrl) {
        trickDocument.videoUrl = req.body.videoUrl;
      }
      if (req.body.feedPostId) {
        trickDocument.feedPostId = req.body.feedPostId;
      }

      const insertResult = await trickCollection.insertOne(trickDocument);
      const trickId = insertResult.insertedId;

      const filter = { _id: new ObjectId(req.body.list_id) };
      const updateDoc = {
        $push: {
          tricks: { _id: new ObjectId(trickId) },
        },
      };
      await tricksCollection.findOneAndUpdate(filter, updateDoc);

      console.log(`[listing] Trick "${req.body.name}" added to list ${req.body.list_id}`);
      res.status(200).send('Success!');
    } catch (error) {
      console.error('[listing] Error inserting trick:', error);
      res.status(400).send('Error inserting trick!');
    }
  });

  // PUT /listing/:trickId/spot — Link/unlink a spot to a trick
  router.put('/:trickId/spot', auth, async (req, res) => {
    const { trickId } = req.params;
    if (!ObjectId.isValid(trickId)) {
      return res.status(400).json({ error: 'Invalid trick ID' });
    }
    if (!isAdmin(req) && !(await userOwnsTrick(trickId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    try {
      const spotId = req.body.spotId || null;
      // Validate spot exists if linking
      if (spotId) {
        if (!ObjectId.isValid(spotId)) {
          return res.status(400).json({ error: 'Invalid spot ID' });
        }
        const spot = await spotsCollection.findOne({ _id: new ObjectId(spotId) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }
      }
      await trickCollection.updateOne(
        { _id: new ObjectId(trickId) },
        { $set: { spotId: spotId, updatedAt: new Date() } },
      );
      // Return updated trick with spot data
      const trick = await trickCollection.findOne({ _id: new ObjectId(trickId) });
      const populated = await populateSpotData([trick]);
      res.json(populated[0]);
    } catch (error) {
      console.error('Error linking spot to trick:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /listing/:trickId/video — Link a feed post or external video to a trick
  router.put('/:trickId/video', auth, async (req, res) => {
    const { trickId } = req.params;
    if (!ObjectId.isValid(trickId)) {
      return res.status(400).json({ error: 'Invalid trick ID' });
    }
    if (!isAdmin(req) && !(await userOwnsTrick(trickId, req.user.userId))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    try {
      const setFields = { updatedAt: new Date() };
      if (req.body.videoUrl !== undefined) {
        setFields.videoUrl = req.body.videoUrl || null;
      }
      if (req.body.feedPostId !== undefined) {
        setFields.feedPostId = req.body.feedPostId || null;
      }
      await trickCollection.updateOne({ _id: new ObjectId(trickId) }, { $set: setFields });
      const trick = await trickCollection.findOne({ _id: new ObjectId(trickId) });
      res.json(trick);
    } catch (error) {
      console.error('Error linking video to trick:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
