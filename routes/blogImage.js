const express = require("express");
const router = express.Router();
const AWS = require("aws-sdk");
const multer = require("multer");
const multerS3 = require("multer-s3");

const s3 = new AWS.S3({
	accessKeyId: process.env.AWS_KEY,
	secretAccessKey: process.env.AWS_SECRET,
});

// configure multer to use S3 for file storage
const upload = multer({
	storage: multerS3({
		s3: s3,
		bucket: "trickbook",
		metadata: function (req, file, cb) {
			cb(null, { fieldName: file.fieldname });
		},
		key: function (req, file, cb) {
			cb(null, Date.now().toString() + "-" + file.originalname);
		},
		limits: { fileSize: 25 * 1024 * 1024 },
	}),
});

router.post("/upload", upload.single("file"), async (req, res) => {
	if (!req.file) {
		return res.status(400).send("No file uploaded.");
	}

	const imageUrl = req.file.location;
	res.status(200).send({ imageUrl });
});

module.exports = router;
