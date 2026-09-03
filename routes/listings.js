//This is the route for CRUD on a TrickList
const express = require('express');
const Joi = require('joi');
const multer = require('multer');

const _store = require('../store/listings');
// const validateWith = require("../middleware/validation");
const auth = require('../middleware/auth');
const authAdmin = require('../middleware/authAdmin');
const jwt = require('jsonwebtoken');
const _delay = require('../middleware/delay');
const _listingMapper = require('../mappers/listings');
const _config = require('config');

const _upload = multer({
  dest: 'uploads/',
  limits: { fieldSize: 25 * 1024 * 1024 },
});

const _schema = {
  title: Joi.string().required(),
  description: Joi.string().allow(''),
  price: Joi.number().required().min(1),
  categoryId: Joi.number().required().min(1),
  location: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }).optional(),
};

const ObjectId = require('mongodb').ObjectId;
const { DBRef } = require('mongodb');

module.exports = (db) => {
  const router = express.Router();
  console.log('Connected to Database');
  const tricksCollection = db.collection('tricklists');

  const isAdmin = (req) => req.user?.role === 'admin';
  // Returns the userId string from the x-auth-token if present and valid, else null.
  const optionalUserId = (req) => {
    const token = req.header('x-auth-token');
    if (!token) return null;
    try {
      return jwt.verify(token, process.env.JWT_SECRET).userId;
    } catch (_err) {
      return null;
    }
  };
  const userOwnsList = async (listId, userId) => {
    if (!ObjectId.isValid(listId)) return false;
    const list = await tricksCollection.findOne({ _id: new ObjectId(listId) });
    const ownerId = list?.user?.oid ?? list?.user?.$id;
    return !!ownerId && String(ownerId) === String(userId);
  };

  //SIMPLE GET TRICKLISTS
  // router.get("/", (req, res) => {
  //   // console.log(req.query.userId);
  //   db.collection('tricklists').find({ "user.$id": req.query.userId }).toArray()
  //   .then(results => {
  //     // console.log(results)
  //     res.send(results);
  //   })
  //   .catch(error => console.error(error))

  //   //const listings = store.getListings();
  //   //const resources = listings.map(listingMapper);

  // });

  //GET TRICK LISTS WITH COMPLETE STATUS
  router.get('/', async (req, res) => {
    try {
      // Only the owner (proven via a valid token) sees private lists; everyone
      // else — logged out or viewing another rider — sees public lists only.
      const requesterId = optionalUserId(req);
      const isOwner = requesterId && String(requesterId) === String(req.query.userId);
      const listQuery = { 'user.$id': req.query.userId };
      if (!isOwner) listQuery.isPublic = true;

      const trickLists = await db.collection('tricklists').find(listQuery).toArray();
      const trickIds = trickLists.flatMap((trickList) =>
        trickList.tricks.map((trick) => trick._id),
      );
      const tricks = await db
        .collection('tricks')
        .find({ _id: { $in: trickIds } })
        .toArray();

      // Build map using string keys for reliable lookup
      // ObjectIds don't work properly as JS object keys
      const trickMap = tricks.reduce((map, trick) => {
        const idStr = trick._id.toString();
        map[idStr] = trick;
        return map;
      }, {});

      const trickListsWithTricks = trickLists.map((trickList) => {
        const trickListCopy = { ...trickList };
        trickListCopy.tricks = trickList.tricks
          .map((trick) => {
            // Convert to string for consistent lookup
            const trickIdStr = trick._id ? trick._id.toString() : null;
            const foundTrick = trickIdStr ? trickMap[trickIdStr] : null;
            return {
              ...trick,
              name: foundTrick?.name || trick.name || 'Unknown Trick',
              checked: foundTrick?.checked || trick.checked || 'To Do',
              link: foundTrick?.link || trick.link || '',
              notes: foundTrick?.notes || trick.notes || '',
              createdAt: foundTrick?.createdAt || trick.createdAt,
              updatedAt: foundTrick?.updatedAt || trick.updatedAt,
            };
          })
          // Sort tricks by most recent activity (updatedAt or createdAt), newest first
          .sort((a, b) => {
            const timeA =
              a.updatedAt || a.createdAt ? new Date(a.updatedAt || a.createdAt).getTime() : 0;
            const timeB =
              b.updatedAt || b.createdAt ? new Date(b.updatedAt || b.createdAt).getTime() : 0;
            return timeB - timeA;
          });
        return trickListCopy;
      });
      res.send(trickListsWithTricks);
    } catch (error) {
      console.error(error);
      res.status(500).send('An error occurred while fetching tricklists.');
    }
  });

  router.get('/countTrickLists', async (req, res) => {
    try {
      const trickLists = await db
        .collection('tricklists')
        .find({ 'user.$id': req.query.userId })
        .toArray();
      const countTrickLists = trickLists.length;
      res.send({ totalTrickLists: countTrickLists });
    } catch (_error) {
      res.status(500).send('error getting total Trick Lists');
    }
  });

  router.post(
    '/',
    auth,
    // [
    //   // Order of these middleware matters.
    //   // "upload" should come before other "validate" because we have to handle
    //   // multi-part form data. Once the upload middleware from multer applied,
    //   // request.body will be populated and we can validate it. This means
    //   // if the request is invalid, we'll end up with one or more image files
    //   // stored in the uploads folder. We'll need to clean up this folder
    //   // using a separate process.
    //   // auth,
    //   upload.array("images", config.get("maxImageCount")),
    //   validateWith(schema),
    //   validateCategoryId,
    //   imageResize,
    // ],

    async (req, res) => {
      const listing = {
        name: req.body.title,
        user: new DBRef('users', req.user.userId),
        completed: 0,
        tricks: [],
        isPublic: req.body.isPublic === true,
        createdAt: new Date(),
      };
      console.log(listing);
      db.collection('tricklists')
        .insertOne(listing)
        .then((results) => {
          console.log(results);
          res.status(201).send(listing);
        })
        .catch((error) => {
          console.error(error);
          res.status(400).send('Error inserting trick list!');
        });
      // listing.images = req.images.map((fileName) => ({ fileName: fileName }));
      // if (req.body.location) listing.location = JSON.parse(req.body.location);
      // if (req.user) listing.userId = req.user.userId;

      //add trick list to the DB

      // store.addListing(listing);

      // res.status(201).send(listing);
    },
  );
  router.delete('/:id', auth, async (req, res) => {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }
    if (!isAdmin(req) && !(await userOwnsList(id, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    const result = await db.collection('tricklists').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(500).send({ error: 'Error deleting document' });
    } else {
      const result2 = await db.collection('tricks').deleteMany({ list_id: id });
      if (result2.deletedCount === 0) {
        return res.send({ error: 'No documents deleted' });
      } else {
        return res.send({ message: 'Document deleted successfully' });
      }
    }
  });
  router.put('/edit', auth, async (req, res) => {
    if (!isAdmin(req) && !(await userOwnsList(req.body.trickListId, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }
    const filter3 = { _id: new ObjectId(req.body.trickListId) };
    const update2 = { $set: { name: req.body.name } };
    try {
      const _updateResult = await tricksCollection.findOneAndUpdate(filter3, update2);
      return res.status(200).send('Success!');
    } catch (error) {
      console.log(error);
      return res.status(400).send(error);
    }
  });
  // Admin-only + paginated. Previously dumped every tricklist (with embedded
  // tricks arrays) unbounded — one of the queries that timed out /admin.
  router.get('/all', authAdmin(), async (req, res) => {
    try {
      const page = Math.max(0, Number.parseInt(req.query.page, 10) || 0);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const [items, total] = await Promise.all([
        tricksCollection
          .find()
          .project({ name: 1, user: 1, completed: 1, isPublic: 1, createdAt: 1, tricks: 1 })
          .sort({ createdAt: -1 })
          .skip(page * limit)
          .limit(limit)
          .toArray(),
        tricksCollection.countDocuments(),
      ]);
      // Collapse the tricks array to a count for the list view.
      const rows = items.map(({ tricks, ...rest }) => ({
        ...rest,
        tricksCount: Array.isArray(tricks) ? tricks.length : 0,
      }));
      res
        .status(200)
        .send({ items: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error) {
      console.error(error);
      res.status(500).send('Error getting tricks');
    }
  });

  // Get all public trick lists (for "Homie Trick Lists")
  router.get('/public', async (_req, res) => {
    try {
      const publicLists = await db.collection('tricklists').find({ isPublic: true }).toArray();

      // Fetch user info for each list
      const userIds = publicLists.filter((list) => list.user?.$id).map((list) => list.user.$id);

      const users = await db
        .collection('users')
        .find({
          _id: { $in: userIds.map((id) => (typeof id === 'string' ? new ObjectId(id) : id)) },
        })
        .project({ name: 1 })
        .toArray();

      const userMap = users.reduce((map, user) => {
        map[user._id.toString()] = { name: user.name, _id: user._id };
        return map;
      }, {});

      const listsWithUsers = publicLists.map((list) => ({
        ...list,
        user: list.user?.$id
          ? userMap[list.user.$id.toString()] || { name: 'Anonymous' }
          : { name: 'Anonymous' },
      }));

      res.status(200).send(listsWithUsers);
    } catch (error) {
      console.error('Error fetching public trick lists:', error);
      res.status(500).send('Error getting public trick lists');
    }
  });

  // Toggle trick list visibility (public/private)
  router.put('/:id/visibility', auth, async (req, res) => {
    const id = req.params.id;
    const { isPublic } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: 'Invalid ID' });
    }
    if (!isAdmin(req) && !(await userOwnsList(id, req.user.userId))) {
      return res.status(403).send({ error: 'Access denied.' });
    }

    try {
      const result = await tricksCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { isPublic: isPublic === true } },
        { returnDocument: 'after' },
      );

      if (!result.value) {
        return res.status(404).send({ error: 'Trick list not found' });
      }

      res.status(200).send(result.value);
    } catch (error) {
      console.error('Error toggling visibility:', error);
      res.status(500).send({ error: 'Error updating visibility' });
    }
  });

  return router;
};
