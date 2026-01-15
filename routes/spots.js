const express = require("express");
const router = express.Router();
const Joi = require("joi");
const { MongoClient, ObjectId } = require("mongodb");
const validateWith = require("../middleware/validation");
const auth = require("../middleware/auth");
const authAdmin = require("../middleware/authAdmin");
const connectionString = process.env.ATLAS_URI;

const schema = {
	name: Joi.string().required(),
	latitude: Joi.number().required(),
	longitude: Joi.number().required(),
	imageURL: Joi.string().uri().allow("").allow(null).optional(),
	description: Joi.string().allow("").optional(),
	rating: Joi.number().min(0).max(5).optional(),
	tags: Joi.string().allow("").optional(),
	city: Joi.string().allow("").optional(),
	state: Joi.string().allow("").optional(),
	isPublic: Joi.boolean().optional(),
};

const updateSchema = {
	name: Joi.string().optional(),
	latitude: Joi.number().optional(),
	longitude: Joi.number().optional(),
	imageURL: Joi.string().uri().allow("").allow(null).optional(),
	description: Joi.string().allow("").optional(),
	rating: Joi.number().min(0).max(5).optional(),
	tags: Joi.string().allow("").optional(),
	city: Joi.string().allow("").optional(),
	state: Joi.string().allow("").optional(),
	isPublic: Joi.boolean().optional(),
};

const approvalSchema = {
	status: Joi.string().valid("approved", "rejected").required(),
	rejectionReason: Joi.string().allow("").optional(),
};

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const spotsCollection = db.collection("spots");
		const spotListsCollection = db.collection("spotlists");

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
				isPublic,
			} = req.body;

			// Check if spot already exists by lat/long
			const existingSpot = await spotsCollection.findOne({
				latitude: latitude,
				longitude: longitude,
			});

			if (existingSpot) {
				return res.status(200).json(existingSpot);
			}

			// Determine approval status based on isPublic flag
			let approvalStatus = "private";
			if (isPublic === true) {
				approvalStatus = "pending";
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
				isPublic: isPublic || false,
				approvalStatus,
				userId: ObjectId(req.user.userId),
				createdAt: new Date(),
			};

			// Add submittedAt if submitted for public approval
			if (isPublic === true) {
				spot.submittedAt = new Date();
			}

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

		// Get all approved public spots with pagination
		router.get("/", async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = parseInt(req.query.limit) || 50;
				const skip = (page - 1) * limit;
				const sort = req.query.sort || "name";
				const order = req.query.order === "desc" ? -1 : 1;

				// Only return approved public spots for public API
				const query = { approvalStatus: "approved" };

				const totalCount = await spotsCollection.countDocuments(query);
				const spots = await spotsCollection
					.find(query)
					.sort({ [sort]: order })
					.skip(skip)
					.limit(limit)
					.toArray();

				res.status(200).json({
					spots,
					pagination: {
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
						hasMore: page * limit < totalCount,
					},
				});
			} catch (error) {
				console.error("Error retrieving spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get all spots (including unapproved) - Admin only
		router.get("/all", [authAdmin()], async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = parseInt(req.query.limit) || 50;
				const skip = (page - 1) * limit;
				const sort = req.query.sort || "name";
				const order = req.query.order === "desc" ? -1 : 1;

				const totalCount = await spotsCollection.countDocuments();
				const spots = await spotsCollection
					.find()
					.sort({ [sort]: order })
					.skip(skip)
					.limit(limit)
					.toArray();

				res.status(200).json({
					spots,
					pagination: {
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
						hasMore: page * limit < totalCount,
					},
				});
			} catch (error) {
				console.error("Error retrieving all spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get pending spots for admin review
		router.get("/pending", [authAdmin()], async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = parseInt(req.query.limit) || 50;
				const skip = (page - 1) * limit;

				const query = { approvalStatus: "pending" };

				const totalCount = await spotsCollection.countDocuments(query);
				const spots = await spotsCollection
					.find(query)
					.sort({ submittedAt: -1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				res.status(200).json({
					spots,
					pagination: {
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
						hasMore: page * limit < totalCount,
					},
				});
			} catch (error) {
				console.error("Error retrieving pending spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Search spots with filters (only approved spots)
		router.get("/search", async (req, res) => {
			try {
				const { q, city, state, tags } = req.query;
				const page = parseInt(req.query.page) || 1;
				const limit = parseInt(req.query.limit) || 50;
				const skip = (page - 1) * limit;

				// Only search approved spots for public API
				const query = { approvalStatus: "approved" };

				// Text search on name
				if (q) {
					query.name = { $regex: q, $options: "i" };
				}

				// Filter by city
				if (city) {
					query.city = { $regex: city, $options: "i" };
				}

				// Filter by state
				if (state) {
					query.state = { $regex: `^${state}$`, $options: "i" };
				}

				// Filter by tags (comma-separated)
				if (tags) {
					const tagList = tags.split(",").map((t) => t.trim());
					query.tags = {
						$regex: tagList.map((t) => `(?=.*${t})`).join(""),
						$options: "i",
					};
				}

				const totalCount = await spotsCollection.countDocuments(query);
				const spots = await spotsCollection
					.find(query)
					.sort({ name: 1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				res.status(200).json({
					spots,
					pagination: {
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
						hasMore: page * limit < totalCount,
					},
				});
			} catch (error) {
				console.error("Error searching spots", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Get user's own spots (all statuses)
		router.get("/my-spots", [auth], async (req, res) => {
			try {
				const page = parseInt(req.query.page) || 1;
				const limit = parseInt(req.query.limit) || 50;
				const skip = (page - 1) * limit;

				const query = { userId: ObjectId(req.user.userId) };

				const totalCount = await spotsCollection.countDocuments(query);
				const spots = await spotsCollection
					.find(query)
					.sort({ createdAt: -1 })
					.skip(skip)
					.limit(limit)
					.toArray();

				res.status(200).json({
					spots,
					pagination: {
						page,
						limit,
						totalCount,
						totalPages: Math.ceil(totalCount / limit),
						hasMore: page * limit < totalCount,
					},
				});
			} catch (error) {
				console.error("Error retrieving user spots", error);
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

		// Update a spot
		router.put(
			"/:id",
			[auth, validateWith(updateSchema)],
			async (req, res) => {
				const id = req.params.id;
				if (!ObjectId.isValid(id)) {
					return res.status(400).json({ error: "Invalid ID" });
				}

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

				// Build update object with only provided fields
				const updateFields = {};
				if (name !== undefined) updateFields.name = name;
				if (latitude !== undefined) updateFields.latitude = latitude;
				if (longitude !== undefined) updateFields.longitude = longitude;
				if (imageURL !== undefined) updateFields.imageURL = imageURL;
				if (description !== undefined) updateFields.description = description;
				if (rating !== undefined) updateFields.rating = rating;
				if (tags !== undefined) updateFields.tags = tags;
				if (city !== undefined) updateFields.city = city;
				if (state !== undefined) updateFields.state = state;
				updateFields.updatedAt = new Date();

				try {
					const result = await spotsCollection.updateOne(
						{ _id: ObjectId(id) },
						{ $set: updateFields }
					);

					if (result.matchedCount === 0) {
						return res.status(404).json({ error: "Spot not found" });
					}

					const updatedSpot = await spotsCollection.findOne({
						_id: ObjectId(id),
					});
					res.status(200).json(updatedSpot);
				} catch (error) {
					console.error("Error updating spot", error);
					res.status(500).json({ error: "Internal Server Error" });
				}
			}
		);

		// Approve a spot (admin only)
		router.put("/:id/approve", [authAdmin(), validateWith(approvalSchema)], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}

			try {
				const updateFields = {
					approvalStatus: "approved",
					reviewedAt: new Date(),
					reviewedBy: ObjectId(req.user.userId),
					updatedAt: new Date(),
				};

				const result = await spotsCollection.updateOne(
					{ _id: ObjectId(id) },
					{ $set: updateFields }
				);

				if (result.matchedCount === 0) {
					return res.status(404).json({ error: "Spot not found" });
				}

				const updatedSpot = await spotsCollection.findOne({ _id: ObjectId(id) });
				res.status(200).json(updatedSpot);
			} catch (error) {
				console.error("Error approving spot", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Reject a spot (admin only)
		router.put("/:id/reject", [authAdmin(), validateWith(approvalSchema)], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}

			const { rejectionReason } = req.body;

			try {
				const updateFields = {
					approvalStatus: "rejected",
					rejectionReason: rejectionReason || "",
					reviewedAt: new Date(),
					reviewedBy: ObjectId(req.user.userId),
					updatedAt: new Date(),
				};

				const result = await spotsCollection.updateOne(
					{ _id: ObjectId(id) },
					{ $set: updateFields }
				);

				if (result.matchedCount === 0) {
					return res.status(404).json({ error: "Spot not found" });
				}

				const updatedSpot = await spotsCollection.findOne({ _id: ObjectId(id) });
				res.status(200).json(updatedSpot);
			} catch (error) {
				console.error("Error rejecting spot", error);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		// Delete a spot (admin only)
		router.delete("/:id", [authAdmin()], async (req, res) => {
			const id = req.params.id;
			if (!ObjectId.isValid(id)) {
				return res.status(400).json({ error: "Invalid ID" });
			}

			try {
				// First, remove the spot from all spot lists
				await spotListsCollection.updateMany(
					{ spotIds: ObjectId(id) },
					{ $pull: { spotIds: ObjectId(id) } }
				);

				// Then delete the spot
				const result = await spotsCollection.deleteOne({ _id: ObjectId(id) });

				if (result.deletedCount === 0) {
					return res.status(404).json({ error: "Spot not found" });
				}

				res.status(200).json({ message: "Spot deleted successfully" });
			} catch (error) {
				console.error("Error deleting spot", error);
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
