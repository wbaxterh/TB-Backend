const express = require("express");
const router = express.Router();
const AWS = require("aws-sdk");
const multer = require("multer");
const multerS3 = require("multer-s3");

const s3 = new AWS.S3({
	accessKeyId: process.env.AWS_KEY,
	secretAccessKey: process.env.AWS_SECRET,
	region: process.env.AWS_REGION,
});

// Configure multer to use S3 for file storage
const upload = multer({
	storage: multerS3({
		s3: s3,
		bucket: "trickbook",
		metadata: function (req, file, cb) {
			cb(null, { fieldName: file.fieldname });
		},
		key: function (req, file, cb) {
			// Extract blogUrl from query parameters
			const blogUrl = req.query.blogUrl;
			if (!blogUrl) {
				return cb(new Error("blogUrl is required"), undefined);
			}
			const fileName = `${Date.now().toString()}-${file.originalname}`;
			cb(null, `${blogUrl}/${fileName}`);
		},
	}),
	limits: { fileSize: 2 * 1024 * 1024 }, // Set file size limit to 2MB
});

router.post("/upload", upload.single("file"), async (req, res) => {
	if (!req.file) {
		return res.status(400).send("No file uploaded.");
	}
	const imageUrl = req.file.location;
	res.status(200).send({ imageUrl });
});

module.exports = router;
