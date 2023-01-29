const express = require("express");
const router = express.Router();
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const usersStore = require("../store/users");
const validateWith = require("../middleware/validation");

const { MongoClient } = require("mongodb");
const ObjectId = require('mongodb').ObjectId;
const connectionString = process.env.ATLAS_URI;

const schema = {
  email: Joi.string().email().required(),
  password: Joi.string().required().min(5),
};


MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then(client => {
    const db = client.db('TrickList2')
    const usersCollection = db.collection('users')

router.post("/", validateWith(schema), async (req, res) => {
  const { email, password } = req.body;
  //replace with get users from MongoDB
  try{
    const userExists = await usersCollection.findOne({ email: email });
    if (!userExists || userExists.password !== password){
      return res.status(400).send({ error: "Invalid email or password." });
    }
    console.log(userExists);
    const token = jwt.sign(
      { userId: userExists._id, name: userExists.name, email: userExists.email, imageUri: userExists.imageUri },
      "jwtPrivateKey"
    );
    res.send(token);

  }
  catch(error){
    return res.status(400).send({ error: "Database Error." });
  }
  //const user = usersStore.getUserByEmail(email);
 

    });
  });

module.exports = router;
