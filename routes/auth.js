const express = require("express");
const router = express.Router();
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const bcrypt = require("bcrypt");
const validateWith = require("../middleware/validation");

const { MongoClient } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const connectionString = process.env.ATLAS_URI;

const schema = {
	email: Joi.string().email().required(),
	password: Joi.string().required().min(5),
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");

		router.post("/", validateWith(schema), async (req, res) => {
			const { email, password } = req.body;

			try {
				const userExists = await usersCollection.findOne({ email: email });
				if (!userExists) {
					return res.status(400).send({ error: "Invalid email or password." });
				}

				// Compare the provided password with the hashed password in the database
				const passwordMatch = await bcrypt.compare(
					password,
					userExists.password
				);
				if (!passwordMatch) {
					return res.status(400).send({ error: "Invalid email or password." });
				}

				const token = jwt.sign(
					{
						userId: userExists._id,
						name: userExists.name,
						email: userExists.email,
						imageUri: userExists.imageUri,
						role: userExists.role,
					},
					"jwtPrivateKey"
				);
				res.send({ token });
			} catch (error) {
				console.error(error);
				return res.status(400).send({ error: "Database Error." });
			}
		});
		// Google SSO auth
		router.post("/google-auth", async (req, res) => {
			const { tokenId } = req.body;
			console.log("request body to google auth == ", req.body);
			try {
				// Verify the token with Google
				const ticket = await googleClient.verifyIdToken({
					idToken: tokenId,
					audience: process.env.GOOGLE_CLIENT_ID,
				});

				const payload = ticket.getPayload();
				const { email, name, picture } = payload;

				let user = await usersCollection.findOne({ email: email });
				if (!user) {
					// Create new user if they don't exist
					const newUser = {
						name: name,
						email: email,
						imageUri: picture,
					};
					const result = await usersCollection.insertOne(newUser);
					console.log("New user inserted via google auth: ", result);
					user = result.ops[0];
				} else {
					// Update existing user with SSO data
					await usersCollection.updateOne(
						{ _id: user._id },
						{ $set: { name: name, imageUri: picture } }
					);
				}

				const token = jwt.sign(
					{
						userId: user._id,
						name: user.name,
						email: user.email,
						imageUri: user.imageUri,
						role: user.role ? user.role : null,
					},
					"jwtPrivateKey"
				);
				res.send({ token });
			} catch (error) {
				console.error("Error during Google authentication:", error);
				return res.status(400).send({ error: "Invalid Google ID token." });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
