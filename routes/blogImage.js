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
			const blogUrl = req.body.blogUrl;
			console.log("Blog URL:", blogUrl); // Log the blog URL
			if (!blogUrl) {
				return cb(new Error("blogUrl is required"), undefined);
			}
			const fileName = `${Date.now().toString()}-${file.originalname}`;
			cb(null, `${blogUrl}/${fileName}`);
		},
	}),
	limits: { fileSize: 25 * 1024 * 1024 },
});

router.post(
	"/upload",
	upload.fields([{ name: "file" }, { name: "blogUrl" }]),
	async (req, res) => {
		console.log("Request body:", req.body); // Log the request body to debug
		if (!req.files || !req.files.file) {
			return res.status(400).send("No file uploaded.");
		}

		console.log("Uploaded file metadata:", req.files.file); // Log file metadata to debug

		const imageUrl = req.files.file[0].location;
		res.status(200).send({ imageUrl });
	}
);

module.exports = router;
