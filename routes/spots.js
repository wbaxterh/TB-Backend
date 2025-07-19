const express = require("express");
const router = express.Router();
const Joi = require("joi");
const { MongoClient, ObjectId } = require("mongodb");
const validateWith = require("../middleware/validation");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

const schema = {
	name: Joi.string().required(),
	latitude: Joi.number().required(),
	longitude: Joi.number().required(),
	imageURL: Joi.string().uri().optional(),
	description: Joi.string().allow("").optional(),
	rating: Joi.number().min(0).max(5).optional(),
	tags: Joi.string().allow("").optional(),
	city: Joi.string().allow("").optional(),
	state: Joi.string().allow("").optional(),
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const spotsCollection = db.collection("spots");

		// Create a new spot
		router.post("/", [auth, validateWith(schema)], async (req, res) => {
			const {
				name,
				latitude,
				longitude,
				imageURL,
				description,
				rating,
				tags,
				city,
				state,
			} = req.body;

			// Check if spot already exists by lat/long
			const existingSpot = await spotsCollection.findOne({
				latitude: latitude,
				longitude: longitude,
			});

			if (existingSpot) {
				return res.status(200).json(existingSpot);
			}

			const spot = {
				name,
				latitude,
				longitude,
				imageURL: imageURL || null,
				description: description || "",
				rating: rating || null,
				tags: tags || "",
				city: city || "",
				state: state || "",
			};
			try {
				const result = await spotsCollection.insertOne(spot);
				spot._id = result.insertedId;
				res.status(201).json(spot);
			} catch (error) {
				console.error("Error creating spot", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Bulk insert spots
		router.post("/bulk", [auth], async (req, res) => {
			const { parks } = req.body;
			if (!Array.isArray(parks) || parks.length === 0) {
				return res
					.status(400)
					.json({ error: "parks must be a non-empty array" });
			}
			// Validate each spot (reuse schema)
			const invalid = parks.find((spot) => {
				const { error } = Joi.validate(spot, schema);
				return error;
			});
			if (invalid) {
				return res.status(400).json({ error: "One or more spots are invalid" });
			}
			try {
				const processedSpots = [];

				for (const park of parks) {
					// Check if spot already exists by lat/long
					const existingSpot = await spotsCollection.findOne({
						latitude: park.latitude,
						longitude: park.longitude,
					});

					if (existingSpot) {
						processedSpots.push(existingSpot);
					} else {
						// Insert new spot
						const result = await spotsCollection.insertOne(park);
						const newSpot = { ...park, _id: result.insertedId };
						processedSpots.push(newSpot);
					}
				}

				res.status(201).json(processedSpots);
			} catch (error) {
				console.error("Error bulk inserting spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get all spots
		router.get("/", async (req, res) => {
			try {
				const spots = await spotsCollection.find().toArray();
				res.status(200).json(spots);
			} catch (error) {
				console.error("Error retrieving spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get a single spot by ID
		router.get("/:id", async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}
			try {
				const spot = await spotsCollection.findOne({ _id: ObjectId(id) });
				if (!spot) {
					return res.status(404).json({ error: "Spot not found" });
				}
				res.status(200).json(spot);
			} catch (error) {
				console.error("Error retrieving spot", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get lists containing a specific spot
		router.get("/:id/lists", [auth], async (req, res) => {
			const spotId = req.params.id;
			if (!ObjectId.isValid(spotId)) {
				return res.status(400).json({ error: "Invalid spot ID" });
			}
			try {
				const spotLists = await spotListsCollection
					.find({
						spotIds: ObjectId(spotId),
						userId: req.user.userId,
					})
					.toArray();
				res.status(200).json(spotLists);
			} catch (error) {
				console.error("Error retrieving spot lists", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
