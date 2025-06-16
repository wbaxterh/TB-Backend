const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
require("dotenv").config();

const connectionString = process.env.ATLAS_URI;

async function hashPasswords() {
	const client = new MongoClient(connectionString, {
		useUnifiedTopology: true,
	});

	try {
		await client.connect();
		const db = client.db("TrickList2");
		const usersCollection = db.collection("users");

		const users = await usersCollection.find().toArray();
		const bcryptHashPattern = /^\$2[aby]\$.{56}$/;

		for (let user of users) {
			// Skip users already hashed or using SSO
			if (user.isGoogleSSO || bcryptHashPattern.test(user.password)) {
				continue;
			}

			// Hash the password
			const hashedPassword = await bcrypt.hash(user.password, 10);

			// Update the user's password in the database
			await usersCollection.updateOne(
				{ _id: user._id },
				{ $set: { password: hashedPassword } }
			);
			console.log(`Password for user ${user.email} hashed successfully.`);
		}

		console.log("All passwords hashed successfully.");
	} catch (error) {
		console.error("Error hashing passwords:", error);
	} finally {
		await client.close();
	}
}

hashPasswords();
