const express = require("express");
const router = express.Router();
const Joi = require("joi");
const usersStore = require("../store/users");
const validateWith = require("../middleware/validation");


const { MongoClient } = require("mongodb");
const ObjectId = require('mongodb').ObjectId;
const connectionString = process.env.ATLAS_URI;

const schema = {
  name: Joi.string().required().min(2),
  email: Joi.string().email().required(),
  password: Joi.string().required().min(5),
};
MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then(client => {

    const db = client.db('TrickList2')
    const usersCollection = db.collection('users')

router.post("/", validateWith(schema), async(req, res) => {
  console.log(req.body);
  const { name, email, password } = req.body;
  userBool = false;
  try{
    const userExists = await usersCollection.findOne({ email: email });
    if (userExists) {
      console.log("User found:", userExists);
      userBool = true;
      return res
      .send({ error: "A user with the given email already exists." });
    } else {
      console.log("No user found with that email address.");
    }
  }
  catch(error){
    console.log(error)
  }
  

  // if (usersStore.getUserByEmail(email))
  //   return res
  //     .status(400)
  //     .send({ error: "A user with the given email already exists." });

  const user = { name, email, password };
  if(userBool == false){
    try{
      const insertUser = await usersCollection.insertOne(user).then(result =>{

      }).catch(error => console.log(error))
      res.status(201).send(user);
    }
    catch(error){
      console.log(error)
    }
  }
 

});

router.get("/", async (req, res) => {
  try{
    console.log(req.query.email)
    const userExists2 = await usersCollection.findOne({ email: req.query.email });
    res.status(200).send(userExists2);
  }
  catch(error){
    res.status(400).send("Error Getting User");
  }
});

}).catch(error =>{
  console.log(error)
}); //end mongoClient
module.exports = router;
