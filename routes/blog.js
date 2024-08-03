const express = require("express");
const router = express.Router();
const Joi = require("joi");
const { MongoClient, ObjectId } = require("mongodb");
const validateWith = require("../middleware/validation");
const authAdmin = require("../middleware/authAdmin");
const connectionString = process.env.ATLAS_URI;

const schema = {
	title: Joi.string().required().min(2),
	author: Joi.string().required(),
	date: Joi.date().required(),
	content: Joi.string().required(),
};
const generateUrl = (title) => {
	return title.toLowerCase().replace(/\s+/g, "-");
};
MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const blogCollection = db.collection("blog");

		router.post("/", [authAdmin(), validateWith(schema)], async (req, res) => {
			const { title, author, date, content } = req.body;
			const url = generateUrl(title);
			const blogPost = { title, author, date, content, url };

			try {
				await blogCollection.insertOne(blogPost);
				res.status(201).send(blogPost);
			} catch (error) {
				console.error("Error creating blog post", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		router.get("/", async (req, res) => {
			try {
				const blogPosts = await blogCollection.find().toArray();
				res.status(200).send(blogPosts);
			} catch (error) {
				console.error("Error retrieving blog posts", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		router.get("/:id", async (req, res) => {
			const id = req.params;
			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const blogPost = await blogCollection.findOne({ _id: ObjectId(id) });
				if (!blogPost) {
					return res.status(404).send({ error: "Blog post not found" });
				}
				res.status(200).send(blogPost);
			} catch (error) {
				console.error("Error retrieving blog post", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		router.get("/url/:url", async (req, res) => {
			const url = req.params.url;

			try {
				const blogPost = await blogCollection.findOne({ url: url });
				if (!blogPost) {
					return res.status(404).send({ error: "Blog post not found" });
				}
				res.status(200).send(blogPost);
			} catch (error) {
				console.error("Error retrieving blog post by URL", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});

		router.delete("/:id", authAdmin(), async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).send({ error: "Invalid ID" });
			}

			try {
				const result = await blogCollection.deleteOne({ _id: ObjectId(id) });
				if (result.deletedCount === 0) {
					return res.status(404).send({ error: "Blog post not found" });
				}
				res.send({ message: "Blog post deleted successfully" });
			} catch (error) {
				console.error("Error deleting blog post", error);
				res.status(500).send({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
