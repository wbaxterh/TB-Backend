//This is the route for CRUD on a TrickList
const express = require("express");
const router = express.Router();
const Joi = require("joi");
const multer = require("multer");

const store = require("../store/listings");
const categoriesStore = require("../store/categories");
const validateWith = require("../middleware/validation");
const auth = require("../middleware/auth");
const imageResize = require("../middleware/imageResize");
const delay = require("../middleware/delay");
const listingMapper = require("../mappers/listings");
const config = require("config");

const upload = multer({
  dest: "uploads/",
  limits: { fieldSize: 25 * 1024 * 1024 },
});

const schema = {
  title: Joi.string().required(),
  description: Joi.string().allow(""),
  price: Joi.number().required().min(1),
  categoryId: Joi.number().required().min(1),
  location: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }).optional(),
};

const validateCategoryId = (req, res, next) => {
  if (!categoriesStore.getCategory(parseInt(req.body.categoryId)))
    return res.status(400).send({ error: "Invalid categoryId." });

  next();
};
const ObjectId = require('mongodb').ObjectId;
const { MongoClient, DBRef } = require("mongodb");
const connectionString = process.env.ATLAS_URI;
MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to Database')
    const db = client.db('TrickList2')
    const tricksCollection = db.collection('tricklists')
  
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
router.get("/", async (req, res) => {
  try {
    const trickLists = await db.collection('tricklists').find({ "user.$id": req.query.userId }).toArray();
    const trickIds = trickLists.flatMap(trickList => trickList.tricks.map(trick => trick._id));
    const tricks = await db.collection('tricks').find({ _id: { $in: trickIds } }).toArray();
    const trickMap = tricks.reduce((map, trick) => {
      map[trick._id] = trick;
      return map;
    }, {});
    const trickListsWithTricks = trickLists.map(trickList => {
      const trickListCopy = { ...trickList };
      trickListCopy.tricks = trickList.tricks.map(trick => ({
        ...trick,
        checked: trickMap[trick._id]?.checked || false
      }));
      return trickListCopy;
    });
    res.send(trickListsWithTricks);
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred while fetching tricklists.');
  }
});

router.get("/countTrickLists", async(req, res) => {
  try{
    const trickLists = await db.collection('tricklists').find({ "user.$id": req.query.userId }).toArray();
    const countTrickLists = trickLists.length;
    res.send({totalTrickLists: countTrickLists});
  }
  catch(error){
    res.status(500).send("error getting total Trick Lists");
  }
});

router.post(
  "/",
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
      user: new DBRef("users", req.body.userId),
      completed: 0,
      tricks: []
      // price: parseFloat(req.body.price),
      // categoryId: parseInt(req.body.categoryId),
      // description: req.body.description,
    };
    console.log(listing);
    db.collection('tricklists').insertOne(listing).then(results => {
      console.log(results)
      res.status(201).send(listing);
    })
    .catch(error => {
      console.error(error); 
      res.status(400).send("Error inserting trick list!");}
      )
    // listing.images = req.images.map((fileName) => ({ fileName: fileName }));
    // if (req.body.location) listing.location = JSON.parse(req.body.location);
    // if (req.user) listing.userId = req.user.userId;

    //add trick list to the DB

    // store.addListing(listing);

    // res.status(201).send(listing);
  }
 
);
router.delete("/:id", async(req, res) => {
  const id = req.params.id;

  
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: 'Invalid ID' });
  }
  const result = await db.collection('tricklists').deleteOne({ _id: ObjectId(id) });

  if(result.deletedCount === 0){
    return res.status(500).send({ error: 'Error deleting document' });

}
else{
  const result2 = await db.collection('tricks').deleteMany({ list_id: id });
  if(result2.deletedCount === 0){
    return res.send({ error: 'No documents deleted' });
  }
  else{
    return res.send({ message: 'Document deleted successfully' });
  }
}
   
    

});
router.put("/edit", async (req, res) => {
  const filter3 = { _id: ObjectId(req.body.trickListId)};
      const update2 = { $set: { name: req.body.name} };
    try{
      const updateResult = await tricksCollection.findOneAndUpdate(filter3, update2);
      return res.status(200).send("Success!");
    }
    catch(error){
      console.log(error);
      return res.status(400).send(error);
    }
  });
router.get("/all", async (req, res) =>{
  try {
    const allTrickLists = await tricksCollection.find().toArray();
    res.status(200).send(allTrickLists);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error getting tricks");
  }
})
})

module.exports = router;
