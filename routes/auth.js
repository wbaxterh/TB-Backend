const express = require("express");
const router = express.Router();
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const appleSignin = require("apple-signin-auth");
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

				// Check if user has a password (SSO users might not have one)
				if (!userExists.password) {
					return res.status(400).send({ error: "This account uses Google Sign-In. Please log in with Google." });
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
					process.env.JWT_SECRET
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
			// Accept tokens from web, iOS, and Android clients
			const ticket = await googleClient.verifyIdToken({
				idToken: tokenId,
				audience: [
					process.env.GOOGLE_CLIENT_ID, // Web
					process.env.GOOGLE_IOS_CLIENT_ID, // iOS
					process.env.GOOGLE_ANDROID_CLIENT_ID, // Android
				].filter(Boolean),
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
					//console.log("New user inserted via google auth: ", result);
					user = {
						_id: result.insertedId,
						...newUser,
					};
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
					process.env.JWT_SECRET
				);
				res.send({ token });
			} catch (error) {
				console.error("Error during Google authentication:", error);
				return res.status(400).send({ error: "Invalid Google ID token." });
			}
		});

		// Apple SSO auth
		router.post("/apple-auth", async (req, res) => {
			const { identityToken, fullName, email } = req.body;
			console.log("request body to apple auth == ", req.body);
			try {
				// Verify the token with Apple
				const applePayload = await appleSignin.verifyIdToken(identityToken, {
					audience: process.env.APPLE_CLIENT_ID, // Your app's bundle identifier
					ignoreExpiration: false,
				});

				const appleUserId = applePayload.sub;
				// Apple only provides email on first sign-in, use from token if available
				const userEmail = email || applePayload.email;

				let user = await usersCollection.findOne({
					$or: [
						{ appleUserId: appleUserId },
						{ email: userEmail }
					]
				});

				if (!user) {
					// Create new user if they don't exist
					const newUser = {
						name: fullName || "Apple User",
						email: userEmail,
						appleUserId: appleUserId,
					};
					const result = await usersCollection.insertOne(newUser);
					user = {
						_id: result.insertedId,
						...newUser,
					};
				} else if (!user.appleUserId) {
					// Link existing email account with Apple ID
					await usersCollection.updateOne(
						{ _id: user._id },
						{ $set: { appleUserId: appleUserId } }
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
					process.env.JWT_SECRET
				);
				res.send({ token });
			} catch (error) {
				console.error("Error during Apple authentication:", error);
				return res.status(400).send({ error: "Invalid Apple identity token." });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
