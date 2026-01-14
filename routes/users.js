const express = require("express");
const router = express.Router();
const Joi = require("joi");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const usersStore = require("../store/users");
const validateWith = require("../middleware/validation");
const authAccountOrAdmin = require("../middleware/authAccountOrAdmin");
const { MongoClient } = require("mongodb");
const ObjectId = require("mongodb").ObjectId;
const connectionString = process.env.ATLAS_URI;

// Email transporter for password reset
const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASSWORD,
	},
});

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

		// Forgot Password - sends reset email
		router.post("/forgot-password", async (req, res) => {
			const { email } = req.body;

			if (!email) {
				return res.status(400).send({ error: "Email is required" });
			}

			try {
				const user = await usersCollection.findOne({ email: email.toLowerCase() });

				if (!user) {
					// Don't reveal if user exists or not for security
					return res.status(200).send({ message: "If an account with that email exists, a reset link has been sent." });
				}

				// Check if user signed up with Google SSO
				if (user.isGoogleSSO) {
					return res.status(400).send({ error: "This account uses Google Sign-In. Please log in with Google." });
				}

				// Generate reset token
				const resetToken = crypto.randomBytes(32).toString("hex");
				const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

				// Save token to user document
				await usersCollection.updateOne(
					{ _id: user._id },
					{
						$set: {
							resetToken: resetToken,
							resetTokenExpiry: resetTokenExpiry,
						},
					}
				);

				// Send reset email
				const resetUrl = `${process.env.FRONTEND_URL || "https://thetrickbook.com"}/reset-password?token=${resetToken}`;

				const mailOptions = {
					from: process.env.EMAIL_USER,
					to: email,
					subject: "TrickBook Password Reset",
					html: `
						<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
							<h2 style="color: #333;">Reset Your Password</h2>
							<p>Hi ${user.name || "there"},</p>
							<p>You requested to reset your password for your TrickBook account.</p>
							<p>Click the button below to reset your password. This link will expire in 1 hour.</p>
							<a href="${resetUrl}" style="display: inline-block; background-color: #4A90D9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 16px 0;">Reset Password</a>
							<p>If you didn't request this, you can safely ignore this email.</p>
							<p>- The TrickBook Team</p>
						</div>
					`,
				};

				await transporter.sendMail(mailOptions);

				res.status(200).send({ message: "If an account with that email exists, a reset link has been sent." });
			} catch (error) {
				console.error("Forgot password error:", error);
				res.status(500).send({ error: "Failed to process request" });
			}
		});

		// Reset Password - validates token and updates password
		router.post("/reset-password", async (req, res) => {
			const { token, newPassword } = req.body;

			if (!token || !newPassword) {
				return res.status(400).send({ error: "Token and new password are required" });
			}

			if (newPassword.length < 5) {
				return res.status(400).send({ error: "Password must be at least 5 characters" });
			}

			try {
				const user = await usersCollection.findOne({
					resetToken: token,
					resetTokenExpiry: { $gt: Date.now() },
				});

				if (!user) {
					return res.status(400).send({ error: "Invalid or expired reset token" });
				}

				// Hash the new password
				const hashedPassword = await bcrypt.hash(newPassword, 10);

				// Update password and clear reset token
				await usersCollection.updateOne(
					{ _id: user._id },
					{
						$set: { password: hashedPassword },
						$unset: { resetToken: "", resetTokenExpiry: "" },
					}
				);

				res.status(200).send({ message: "Password reset successful. You can now log in with your new password." });
			} catch (error) {
				console.error("Reset password error:", error);
				res.status(500).send({ error: "Failed to reset password" });
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
