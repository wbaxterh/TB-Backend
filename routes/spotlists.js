const express = require("express");
const router = express.Router();
const Joi = require("joi");
const { MongoClient, ObjectId } = require("mongodb");
const validateWith = require("../middleware/validation");
const auth = require("../middleware/auth");
const subscriptionMiddleware = require("../middleware/subscription");
const connectionString = process.env.ATLAS_URI;

const schema = {
	name: Joi.string().required(),
	description: Joi.string().allow("").optional(),
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const spotListsCollection = db.collection("spotlists");
		const spotsCollection = db.collection("spots");

		// Create a new spot list
		router.post(
			"/",
			[auth, subscriptionMiddleware.checkSpotListLimit, validateWith(schema)],
			async (req, res) => {
				const { name, description } = req.body;
				const spotList = {
					name,
					description: description || "",
					userId: req.user.userId,
					spotIds: [],
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				try {
					const result = await spotListsCollection.insertOne(spotList);
					spotList._id = result.insertedId;
					res.status(201).json(spotList);
				} catch (error) {
					console.error("Error creating spot list", error);
					res.status(500).json({ error: "Internal Server Error" });
				}
			}
		);

		// Get user's current usage
		router.get("/usage", [auth], subscriptionMiddleware.getUserUsage);

		// Get all spot lists for the authenticated user
		router.get("/", [auth], async (req, res) => {
			try {
				const spotLists = await spotListsCollection
					.find({ userId: req.user.userId })
					.toArray();

				// Add spotCount to each list
				const listsWithCount = spotLists.map((list) => ({
					...list,
					spotCount: list.spotIds ? list.spotIds.length : 0,
				}));

				res.status(200).json(listsWithCount);
			} catch (error) {
				console.error("Error retrieving spot lists", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get a single spot list by ID (only if owned by user)
		router.get("/:id", [auth], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}
			try {
				const spotList = await spotListsCollection.findOne({
					_id: ObjectId(id),
					userId: req.user.userId,
				});
				if (!spotList) {
					return res.status(404).json({ error: "Spot list not found" });
				}
				// Add spotCount
				const listWithCount = {
					...spotList,
					spotCount: spotList.spotIds ? spotList.spotIds.length : 0,
				};
				res.status(200).json(listWithCount);
			} catch (error) {
				console.error("Error retrieving spot list", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Update a spot list (only if owned by user)
		router.put("/:id", [auth, validateWith(schema)], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}
			const { name, description } = req.body;
			try {
				const result = await spotListsCollection.updateOne(
					{
						_id: ObjectId(id),
						userId: req.user.userId,
					},
					{
						$set: {
							name,
							description: description || "",
							updatedAt: new Date(),
						},
					}
				);
				if (result.matchedCount === 0) {
					return res.status(404).json({ error: "Spot list not found" });
				}
				res.status(200).json({ message: "Spot list updated successfully" });
			} catch (error) {
				console.error("Error updating spot list", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Delete a spot list (only if owned by user)
		router.delete("/:id", [auth], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}
			try {
				const result = await spotListsCollection.deleteOne({
					_id: ObjectId(id),
					userId: req.user.userId,
				});
				if (result.deletedCount === 0) {
					return res.status(404).json({ error: "Spot list not found" });
				}
				res.status(200).json({ message: "Spot list deleted successfully" });
			} catch (error) {
				console.error("Error deleting spot list", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Add a spot to a list
		router.post(
			"/:id/spots",
			[
				auth,
				subscriptionMiddleware.checkSpotLimit,
				subscriptionMiddleware.checkTotalSpotsLimit,
			],
			async (req, res) => {
				const listId = req.params.id;
				const { spotId } = req.body;

				if (!ObjectId.isValid(listId)) {
					return res.status(400).json({ error: "Invalid list ID" });
				}
				if (!ObjectId.isValid(spotId)) {
					return res.status(400).json({ error: "Invalid spot ID" });
				}

				try {
					// Check if spot exists
					const spot = await spotsCollection.findOne({ _id: ObjectId(spotId) });
					if (!spot) {
						return res.status(404).json({ error: "Spot not found" });
					}

					// Add spot to list
					const result = await spotListsCollection.updateOne(
						{
							_id: ObjectId(listId),
							userId: req.user.userId,
						},
						{
							$addToSet: { spotIds: ObjectId(spotId) },
							$set: { updatedAt: new Date() },
						}
					);

					if (result.matchedCount === 0) {
						return res.status(404).json({ error: "Spot list not found" });
					}

					res.status(200).json({ message: "Spot added to list successfully" });
				} catch (error) {
					console.error("Error adding spot to list", error);
					res.status(500).json({ error: "Internal Server Error" });
				}
			}
		);

		// Remove a spot from a list
		router.delete("/:id/spots/:spotId", [auth], async (req, res) => {
			const listId = req.params.id;
			const spotId = req.params.spotId;

			if (!ObjectId.isValid(listId)) {
				return res.status(400).json({ error: "Invalid list ID" });
			}
			if (!ObjectId.isValid(spotId)) {
				return res.status(400).json({ error: "Invalid spot ID" });
			}

			try {
				const result = await spotListsCollection.updateOne(
					{
						_id: ObjectId(listId),
						userId: req.user.userId,
					},
					{
						$pull: { spotIds: ObjectId(spotId) },
						$set: { updatedAt: new Date() },
					}
				);

				if (result.matchedCount === 0) {
					return res.status(404).json({ error: "Spot list not found" });
				}

				res
					.status(200)
					.json({ message: "Spot removed from list successfully" });
			} catch (error) {
				console.error("Error removing spot from list", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get all spots in a list
		router.get("/:id/spots", [auth], async (req, res) => {
			const listId = req.params.id;

			if (!ObjectId.isValid(listId)) {
				return res.status(400).json({ error: "Invalid list ID" });
			}

			try {
				const spotList = await spotListsCollection.findOne({
					_id: ObjectId(listId),
					userId: req.user.userId,
				});

				if (!spotList) {
					return res.status(404).json({ error: "Spot list not found" });
				}

				// Get all spots in the list
				const spots = await spotsCollection
					.find({ _id: { $in: spotList.spotIds } })
					.toArray();

				res.status(200).json(spots);
			} catch (error) {
				console.error("Error retrieving spots in list", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
