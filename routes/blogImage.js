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
	limits: { fileSize: 5 * 1024 * 1024 }, // Set file size limit to 5MB
});

router.post("/upload", upload.single("file"), async (req, res) => {
	if (!req.file) {
		return res.status(400).send("No file uploaded.");
	}
	const imageUrl = req.file.location;
	res.status(200).send({ imageUrl });
});

router.delete("/delete-folder/:slug", async (req, res) => {
	const { slug } = req.params;

	// Define the S3 bucket and prefix (folder)
	const bucketParams = {
		Bucket: "trickbook",
		Prefix: `${slug}/`, // The folder is named after the slug
	};

	try {
		// List all objects in the folder
		const listedObjects = await s3.listObjectsV2(bucketParams).promise();

		if (listedObjects.Contents.length === 0) {
			return res
				.status(404)
				.send({ error: "No objects found in the specified folder." });
		}

		// Create a list of keys to delete
		const deleteParams = {
			Bucket: "trickbook",
			Delete: { Objects: [] },
		};

		listedObjects.Contents.forEach(({ Key }) => {
			deleteParams.Delete.Objects.push({ Key });
		});

		// Delete the objects
		await s3.deleteObjects(deleteParams).promise();

		res
			.status(200)
			.send({ message: "Folder and all its contents deleted successfully." });
	} catch (error) {
		console.error("Error deleting folder in S3", error);
		res.status(500).send({ error: "Internal Server Error" });
	}
});

module.exports = router;
