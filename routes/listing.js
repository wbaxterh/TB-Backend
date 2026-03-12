//This is the route for CRUD on a Trick
const express = require('express');
const router = express.Router();

const _store = require('../store/listings');
const _auth = require('../middleware/auth');
const _listingMapper = require('../mappers/listings');

const { MongoClient } = require('mongodb');
const ObjectId = require('mongodb').ObjectId;
const connectionString = process.env.ATLAS_URI;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then((client) => {
    // console.log('Connected to Database')
    const db = client.db('TrickList2');
    const tricksCollection = db.collection('tricklists');
    const trickCollection = db.collection('tricks');
    const _trick_id = '';

    router.get('/', async (req, res) => {
      db.collection('tricks')
        .find({ list_id: req.query.list_id })
        .toArray()
        .then((results) => {
          res.send(results);
        })
        .catch((error) => console.error(error));
    });

    router.get('/allData', async (_req, res) => {
      try {
        const allTricks = await trickCollection.find().toArray();
        res.status(200).send(allTricks);
      } catch (error) {
        res.status(500).send(error);
      }
    });

    router.get('/allTricks', async (req, res) => {
      try {
        // const result = await trickCollection.estimatedDocumentCount();
        // console.log(result);
        // res.status(200).json({ result }); // send count as JSON response
        //   console.log("There are " + result + " documents in the collection.");
        // Define the user id for which you want to get the total count of tricks
        // Find all the tricklists that belong to the user
        const tricklists = await tricksCollection.find({ 'user.$id': req.query.userId }).toArray();
        // Extract the tricks array from each tricklist and flatten it
        const trickIds = tricklists.flatMap((tricklist) =>
          tricklist.tricks.map((trick) => new ObjectId(trick._id)),
        );
        const totalTricks = trickIds.length;
        // Return the total count of tricks for the user
        res.send({ totalTricks: totalTricks });
      } catch (error) {
        res.status(500).send(error);
      }
    });

    //data for graph
    router.get('/graph', async (_req, res) => {
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
              color: (opacity = 1) => `rgba(0, 0, 255, ${opacity})`, // blue color for the line
            },
          ],
        };

        // Convert the results into the required format for the line chart
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

    router.delete('/:id', async (req, res) => {
      const id = req.params.id;
      // console.log(req.params);
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: 'Invalid ID' });
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
        // console.log(result2);
        return res.send({ message: 'Document deleted successfully' });
      }
    });
    router.put('/edit', async (req, res) => {
      const filter3 = { _id: new ObjectId(req.body.trickId) };
      const update2 = {
        $set: {
          name: req.body.name,
          link: req.body.link,
          notes: req.body.notes,
          updatedAt: new Date(),
        },
      };
      try {
        const _updateResult = await trickCollection.findOneAndUpdate(filter3, update2);
        return res.status(200).send('Success!');
      } catch (error) {
        console.log(error);
        return res.status(400).send(error);
      }
    });
    router.put('/update', async (req, res) => {
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
    router.put('/', async (req, res) => {
      try {
        // Build trick document with createdAt timestamp
        const trickDocument = {
          ...req.body,
          createdAt: new Date(),
        };

        // Insert trick into tricks collection
        const insertResult = await trickCollection.insertOne(trickDocument);
        const trickId = insertResult.insertedId;

        // Link trick to the tricklist (MUST await this!)
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

      // trickCollection.insertOne(req.body).then(results => {
      //   console.log(req.body);
      //   // create a filter for a movie to update
      //   const filter = { _id: req.body.list_id };
      //   trick_id = req.body._id;
      //   const updateDoc = {
      //     $push: {
      //       tricks: trick_id
      //     },
      //   };
      //   tricksCollection.updateOne(filter, updateDoc).then(result => {
      //     console.log(" document(s) matched the filter, updated " + result.modifiedCount);
      //     res.status(201).send("Success!");
      //   })
      //     .catch(error => console.error(error))
      // })
      // .catch(error => {
      //   console.error(error);
      //   res.status(400).send("Error inserting trick!");}
      //   );
      //const trickLength = db.collection('tricklists').find({id: req.body.list_id}).toArray();
      //console.log(trickLength);
      //let trick = {...req.body, id: trickLength.tricks_length}

      // const listing = store.getListing(parseInt(req.params.id));
      // listing.tricks.append()
      //store.addTrick(req.body);
    });
  })
  .catch((error) => {
    console.log(error);
  });

module.exports = router;
