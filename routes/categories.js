const express = require("express");
const router = express.Router();
const { MongoClient, ObjectId } = require("mongodb");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

// Utility: Only admin can create/update/delete
const adminCheck = (req, res, next) => {
	if (!req.user || req.user.role !== "admin") {
		return res.status(403).json({ message: "Admin access required" });
	}
	next();
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const categoriesCollection = db.collection("categories");

		// GET all categories
		router.get("/", async (req, res) => {
			try {
				const categories = await categoriesCollection.find().toArray();
				res.json(categories);
			} catch (error) {
				res.status(500).json({ message: "Error fetching categories" });
			}
		});

		// GET category by ID
		router.get("/:id", async (req, res) => {
			try {
				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid category ID" });
				}
				const category = await categoriesCollection.findOne({
					_id: ObjectId(req.params.id),
				});
				if (!category) {
					return res.status(404).json({ message: "Category not found" });
				}
				res.json(category);
			} catch (error) {
				res.status(500).json({ message: "Error fetching category" });
			}
		});

		// CREATE category (admin only)
		router.post("/", auth, adminCheck, async (req, res) => {
			try {
				const { name, icon, backgroundColor, color } = req.body;
				if (!name || !icon || !backgroundColor || !color) {
					return res.status(400).json({ message: "Missing required fields" });
				}
				const category = { name, icon, backgroundColor, color };
				const result = await categoriesCollection.insertOne(category);
				category._id = result.insertedId;
				res.status(201).json(category);
			} catch (error) {
				res.status(500).json({ message: "Error creating category" });
			}
		});

		// UPDATE category (admin only)
		router.put("/:id", auth, adminCheck, async (req, res) => {
			try {
				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid category ID" });
				}
				const { name, icon, backgroundColor, color } = req.body;
				const update = { name, icon, backgroundColor, color };
				const result = await categoriesCollection.findOneAndUpdate(
					{ _id: ObjectId(req.params.id) },
					{ $set: update },
					{ returnDocument: "after" }
				);
				if (!result.value) {
					return res.status(404).json({ message: "Category not found" });
				}
				res.json(result.value);
			} catch (error) {
				res.status(500).json({ message: "Error updating category" });
			}
		});

		// DELETE category (admin only)
		router.delete("/:id", auth, adminCheck, async (req, res) => {
			try {
				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid category ID" });
				}
				const result = await categoriesCollection.deleteOne({
					_id: ObjectId(req.params.id),
				});
				if (result.deletedCount === 0) {
					return res.status(404).json({ message: "Category not found" });
				}
				res.json({ message: "Category deleted successfully" });
			} catch (error) {
				res.status(500).json({ message: "Error deleting category" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
