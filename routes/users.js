const express = require("express");
const router = express.Router();
const Joi = require("joi");
const bcrypt = require("bcrypt");
const usersStore = require("../store/users");
const validateWith = require("../middleware/validation");
const authAccountOrAdmin = require("../middleware/authAccountOrAdmin");
const { MongoClient } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;
const connectionString = process.env.ATLAS_URI;

const schema = {
	name: Joi.string().required().min(2),
	email: Joi.string().email().required(),
	password: Joi.string().required().min(5),
	isGoogleSSO: Joi.boolean().optional(), // Added field for Google SSO
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");

		router.post("/", validateWith(schema), async (req, res) => {
			const { name, email, password, isGoogleSSO } = req.body;
			let userBool = false;

			try {
				const userExists = await usersCollection.findOne({ email: email });
				if (userExists) {
					userBool = true;
					return res
						.status(400)
						.send({ error: "A user with the given email already exists." });
				}
			} catch (error) {
				console.log(error);
				return res.status(500).send({ error: "Internal Server Error" });
			}

			if (userBool === false) {
				try {
					// If it's not a Google SSO user, hash the password
					const hashedPassword = isGoogleSSO
						? password
						: await bcrypt.hash(password, 10);
					const user = {
						name,
						email,
						password: hashedPassword,
						isGoogleSSO: isGoogleSSO || false,
					};

					await usersCollection.insertOne(user);
					res.status(201).send(user);
				} catch (error) {
					console.log(error);
					res.status(500).send({ error: "Internal Server Error" });
				}
			}
		});

		router.get("/", async (req, res) => {
			try {
				console.log(req.query.email);
				const userExists2 = await usersCollection.findOne({
					email: req.query.email,
				});
				res.status(200).send(userExists2);
			} catch (error) {
				res.status(400).send("Error Getting User");
			}
		});

		router.get("/all", async (req, res) => {
			try {
				const users = await usersCollection.find().toArray();
				res.status(200).send(users);
			} catch (error) {
				console.error(error);
				res.status(500).send("Error getting users");
			}
		});

		router.delete("/:id", authAccountOrAdmin(), async (req, res) => {
			const id = req.params.id;

			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const userToDelete = await usersCollection.findOne({
					_id: ObjectId(id),
				});

				if (!userToDelete) {
					return res.status(404).send({ error: "User not found" });
				}

				const result = await usersCollection.deleteOne({ _id: ObjectId(id) });

				if (result.deletedCount === 0) {
					return res.status(500).send({ error: "Failed to delete user" });
				}

				res.send({ message: "User deleted successfully" });
			} catch (error) {
				console.error(error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});
		// 	router.delete("/:id", async (req, res) => {
		// 		const id = req.params.id;
		// 		if (!ObjectId.isValid(id)) {
		// 			return res.status(400).send({ error: "Invalid ID" });
		// 		}
		// 		const result = await usersCollection.deleteOne({ _id: ObjectId(id) });
		// 		if (result.deletedCount === 0) {
		// 			return res.status(500).send({ error: "Document not found" });
		// 		} else {
		// 			return res.send({ message: "Document deleted successfully" });
		// 		}
		// 	});
	})
	.catch((error) => {
		console.log(error);
	}); // end mongoClient

module.exports = router;
