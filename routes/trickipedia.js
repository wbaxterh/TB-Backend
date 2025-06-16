const express = require("express");
const router = express.Router();
const { MongoClient, ObjectId } = require("mongodb");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

// Validation function for trick data
const validateTrick = (trick) => {
	const requiredFields = [
		"name",
		"category",
		"difficulty",
		"description",
		"steps",
	];
	const missingFields = requiredFields.filter((field) => !trick[field]);

	if (missingFields.length > 0) {
		return {
			isValid: false,
			message: `Missing required fields: ${missingFields.join(", ")}`,
		};
	}

	// Validate data types
	if (typeof trick.name !== "string")
		return { isValid: false, message: "Name must be a string" };
	if (typeof trick.category !== "string")
		return { isValid: false, message: "Category must be a string" };
	if (typeof trick.difficulty !== "string")
		return { isValid: false, message: "Difficulty must be a string" };
	if (typeof trick.description !== "string")
		return { isValid: false, message: "Description must be a string" };
	if (!Array.isArray(trick.steps))
		return { isValid: false, message: "Steps must be an array" };
	if (trick.images && !Array.isArray(trick.images))
		return { isValid: false, message: "Images must be an array" };
	if (trick.videoUrl && typeof trick.videoUrl !== "string")
		return { isValid: false, message: "Video URL must be a string" };
	if (trick.source && typeof trick.source !== "string")
		return { isValid: false, message: "Source must be a string" };

	return { isValid: true };
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		console.log("Connected to Database");
		const db = client.db("TrickList2");
		const trickipediaCollection = db.collection("trickipedia");

		// Get all tricks with optional filtering
		router.get("/", async (req, res) => {
			try {
				const { category, difficulty, search } = req.query;
				let query = {};

				if (category) query.category = category;
				if (difficulty) query.difficulty = difficulty;
				if (search) {
					query.$or = [
						{ name: { $regex: search, $options: "i" } },
						{ description: { $regex: search, $options: "i" } },
					];
				}

				const tricks = await trickipediaCollection
					.find(query)
					.sort({ name: 1 })
					.toArray();

				res.json(tricks);
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error fetching tricks" });
			}
		});

		// Get tricks by category
		router.get("/category/:category", async (req, res) => {
			try {
				const { category } = req.params;
				const { difficulty, search } = req.query;
				let query = { category };

				if (difficulty) query.difficulty = difficulty;
				if (search) {
					query.$or = [
						{ name: { $regex: search, $options: "i" } },
						{ description: { $regex: search, $options: "i" } },
					];
				}

				const tricks = await trickipediaCollection
					.find(query)
					.sort({ name: 1 })
					.toArray();

				if (tricks.length === 0) {
					return res.status(404).json({
						message: `No tricks found in category: ${category}`,
						category: category,
					});
				}

				res.json({
					category: category,
					count: tricks.length,
					tricks: tricks,
				});
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error fetching tricks by category" });
			}
		});

		// Get a single trick by ID
		router.get("/:id", async (req, res) => {
			try {
				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid trick ID" });
				}

				const trick = await trickipediaCollection.findOne({
					_id: ObjectId(req.params.id),
				});

				if (!trick) {
					return res.status(404).json({ message: "Trick not found" });
				}

				res.json(trick);
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error fetching trick" });
			}
		});

		// Create a new trick (admin only)
		router.post("/", auth, async (req, res) => {
			try {
				// Check if user is admin
				if (req.user.role !== "admin") {
					return res.status(403).json({ message: "Admin access required" });
				}

				const validation = validateTrick(req.body);
				if (!validation.isValid) {
					return res.status(400).json({ message: validation.message });
				}

				const trick = {
					name: req.body.name,
					category: req.body.category,
					difficulty: req.body.difficulty,
					description: req.body.description,
					steps: req.body.steps,
					images: req.body.images || [],
					videoUrl: req.body.videoUrl || null,
					source: req.body.source || null,
					createdAt: new Date(),
					updatedAt: new Date(),
				};

				const result = await trickipediaCollection.insertOne(trick);
				trick._id = result.insertedId;

				res.status(201).json(trick);
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error creating trick" });
			}
		});

		// Update a trick (admin only)
		router.put("/:id", auth, async (req, res) => {
			try {
				// Check if user is admin
				if (req.user.role !== "admin") {
					return res.status(403).json({ message: "Admin access required" });
				}

				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid trick ID" });
				}

				const validation = validateTrick(req.body);
				if (!validation.isValid) {
					return res.status(400).json({ message: validation.message });
				}

				const update = {
					name: req.body.name,
					category: req.body.category,
					difficulty: req.body.difficulty,
					description: req.body.description,
					steps: req.body.steps,
					images: req.body.images || [],
					videoUrl: req.body.videoUrl || null,
					source: req.body.source || null,
					updatedAt: new Date(),
				};

				const result = await trickipediaCollection.findOneAndUpdate(
					{ _id: ObjectId(req.params.id) },
					{ $set: update },
					{ returnDocument: "after" }
				);

				if (!result.value) {
					return res.status(404).json({ message: "Trick not found" });
				}

				res.json(result.value);
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error updating trick" });
			}
		});

		// Delete a trick (admin only)
		router.delete("/:id", auth, async (req, res) => {
			try {
				// Check if user is admin
				if (req.user.role !== "admin") {
					return res.status(403).json({ message: "Admin access required" });
				}

				if (!ObjectId.isValid(req.params.id)) {
					return res.status(400).json({ message: "Invalid trick ID" });
				}

				const result = await trickipediaCollection.deleteOne({
					_id: ObjectId(req.params.id),
				});

				if (result.deletedCount === 0) {
					return res.status(404).json({ message: "Trick not found" });
				}

				res.json({ message: "Trick deleted successfully" });
			} catch (error) {
				console.error(error);
				res.status(500).json({ message: "Error deleting trick" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
