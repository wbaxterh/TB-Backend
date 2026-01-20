/**
 * S3 Upload Service
 * Handles image uploads to AWS S3
 */

const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

// Configure AWS
AWS.config.update({
	accessKeyId: process.env.AWS_KEY,
	secretAccessKey: process.env.AWS_SECRET,
	region: process.env.AWS_REGION || "us-east-1",
});

const s3 = new AWS.S3();
const BUCKET_NAME = "trickbook";
const FEED_FOLDER = "feed";

/**
 * Generate a presigned URL for direct upload from client
 * This is more efficient - client uploads directly to S3
 */
async function getPresignedUploadUrl(filename, contentType, folder = FEED_FOLDER) {
	const fileExtension = filename.split(".").pop().toLowerCase();
	const key = `${folder}/${uuidv4()}.${fileExtension}`;

	const params = {
		Bucket: BUCKET_NAME,
		Key: key,
		ContentType: contentType,
		Expires: 300, // URL expires in 5 minutes
	};

	try {
		const uploadUrl = await s3.getSignedUrlPromise("putObject", params);
		const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

		return {
			uploadUrl,
			fileUrl,
			key,
		};
	} catch (error) {
		console.error("Error generating presigned URL:", error);
		throw new Error("Failed to generate upload URL");
	}
}

/**
 * Upload a file buffer directly (for server-side uploads)
 */
async function uploadFile(buffer, filename, contentType, folder = FEED_FOLDER) {
	const fileExtension = filename.split(".").pop().toLowerCase();
	const key = `${folder}/${uuidv4()}.${fileExtension}`;

	const params = {
		Bucket: BUCKET_NAME,
		Key: key,
		Body: buffer,
		ContentType: contentType,
	};

	try {
		await s3.upload(params).promise();
		const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;

		return {
			fileUrl,
			key,
		};
	} catch (error) {
		console.error("Error uploading file:", error);
		throw new Error("Failed to upload file");
	}
}

/**
 * Upload a base64 encoded image
 */
async function uploadBase64Image(base64Data, filename, folder = FEED_FOLDER) {
	// Remove data URL prefix if present
	const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
	const buffer = Buffer.from(base64Image, "base64");

	// Detect content type from data URL or filename
	let contentType = "image/jpeg";
	if (base64Data.includes("data:image/png")) {
		contentType = "image/png";
	} else if (base64Data.includes("data:image/webp")) {
		contentType = "image/webp";
	} else if (base64Data.includes("data:image/gif")) {
		contentType = "image/gif";
	}

	return uploadFile(buffer, filename, contentType, folder);
}

/**
 * Delete a file from S3
 */
async function deleteFile(key) {
	const params = {
		Bucket: BUCKET_NAME,
		Key: key,
	};

	try {
		await s3.deleteObject(params).promise();
		return { success: true };
	} catch (error) {
		console.error("Error deleting file:", error);
		throw new Error("Failed to delete file");
	}
}

/**
 * Delete multiple files from S3
 */
async function deleteFiles(keys) {
	if (!keys || keys.length === 0) return { success: true };

	const params = {
		Bucket: BUCKET_NAME,
		Delete: {
			Objects: keys.map((key) => ({ Key: key })),
		},
	};

	try {
		await s3.deleteObjects(params).promise();
		return { success: true };
	} catch (error) {
		console.error("Error deleting files:", error);
		throw new Error("Failed to delete files");
	}
}

/**
 * Get the public URL for a file
 */
function getPublicUrl(key) {
	return `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
}

module.exports = {
	getPresignedUploadUrl,
	uploadFile,
	uploadBase64Image,
	deleteFile,
	deleteFiles,
	getPublicUrl,
	BUCKET_NAME,
	FEED_FOLDER,
};
