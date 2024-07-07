const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const connectionString = process.env.ATLAS_URI;

const authAdmin = () => {
	return (req, res, next) => {
		let token = req.header("x-auth-token");
		token = token.trim();
		if (!token)
			return res
				.status(401)
				.send({ error: "Access denied. No token provided." });

		try {
			const payload = jwt.verify(token, "jwtPrivateKey");
			req.user = payload;
			MongoClient.connect(connectionString, { useUnifiedTopology: true })
				.then((client) => {
					const db = client.db("TrickList2");
					const usersCollection = db.collection("users");
					usersCollection.findOne(
						{ _id: ObjectId(req.user.userId) },
						(err, user) => {
							if (err) return res.status(500).send("Error verifying user.");
							if (!user) return res.status(400).send("User not found.");

							if (user.role !== "admin") {
								return res.status(403).send("Access denied. Admins only.");
							}

							next();
						}
					);
				})
				.catch((error) => {
					console.error("Error connecting to MongoDB", error);
					res.status(500).send("Internal Server Error");
				});
		} catch (err) {
			res.status(400).send({ error: "Invalid token." });
		}
	};
};

module.exports = authAdmin;
