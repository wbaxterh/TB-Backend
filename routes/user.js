const express = require("express");
const router = express.Router();
const { MongoClient, ObjectId } = require("mongodb");
const auth = require("../middleware/auth");
const connectionString = process.env.ATLAS_URI;

MongoClient.connect(connectionString, { useUnifiedTopology: true })
	.then((client) => {
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");
		// const usersStore = require("../store/users");

		// Existing user route to get user by ID
		// router.get("/:id", auth, (req, res) => {
		// 	const userId = parseInt(req.params.id);
		// 	const user = usersStore.getUserById(userId);
		// 	if (!user) return res.status(404).send();

		// 	const listings = listingsStore.filterListings(
		// 		(listing) => listing.userId === userId
		// 	);

		// 	res.send({
		// 		id: user.id,
		// 		name: user.name,
		// 		email: user.email,
		// 		listings: listings.length,
		// 	});
		// });

		// New route to get the current logged-in user's info
		router.get("/me", auth, async (req, res) => {
			try {
				const userId = req.user._id;
				// console.log("user id == ", userId);
				const user = await usersCollection.findOne({ _id: ObjectId(userId) });
				if (!user) return res.status(404).send("User not found");

				res.send({
					id: user._id,
					name: user.name,
					email: user.email,
					role: user.role,
				});
			} catch (error) {
				console.error("Error retrieving user", error);
				res.status(500).send("Internal Server Error");
			}
		});
	})
	.catch((error) => {
		console.error("Error connecting to MongoDB", error);
	});

module.exports = router;
