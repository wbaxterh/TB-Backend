const express = require("express");
const nodemailer = require("nodemailer");
const router = express.Router();

router.post("/send-email", async (req, res) => {
	const { name, email, message } = req.body;

	const transporter = nodemailer.createTransport({
		service: "gmail",
		auth: {
			user: process.env.EMAIL_USER,
			pass: process.env.EMAIL_PASSWORD,
		},
	});

	const mailOptions = {
		from: email,
		to: "admin@thetrickbook.com",
		subject: `New Contact from ${name}`,
		text: message,
	};

	try {
		await transporter.sendMail(mailOptions);
		res.status(200).send({ success: true });
	} catch (error) {
		console.error(error);
		res.status(500).send({ error: "Failed to send email." });
	}
});

module.exports = router;
