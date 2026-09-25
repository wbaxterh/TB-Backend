const crypto = require('node:crypto');
const path = require('node:path');
const AWS = require('aws-sdk');
const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const auth = require('../middleware/auth');
const { toObjectId } = require('../utils/ids');

const BUCKET = 'trickbook';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

// Object keys never carry the client's filename; only a sanitised extension survives.
function buildObjectKey(file) {
  const ext = path
    .extname(file?.originalname || '')
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .slice(0, 8);
  return `${crypto.randomUUID()}${ext}`;
}

function imageFileFilter(_req, file, cb) {
  cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype));
}

function uploadStatus(error) {
  return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
}

function uploadBody(error) {
  return {
    error: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be 25 MB or smaller.' : 'Upload failed.',
  };
}

function createUploader(s3) {
  return multer({
    storage: multerS3({
      s3,
      bucket: BUCKET,
      metadata: (_req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (_req, file, cb) => cb(null, buildObjectKey(file)),
    }),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: imageFileFilter,
  });
}

module.exports = (db, options = {}) => {
  const router = express.Router();
  const usersCollection = db.collection('users');
  const s3 =
    options.s3 ||
    new AWS.S3({ accessKeyId: process.env.AWS_KEY, secretAccessKey: process.env.AWS_SECRET });
  const upload = options.uploader || createUploader(s3);

  router.get('/', (_req, res) => {
    s3.getObject({ Bucket: BUCKET, Key: 'blank-profile-picture.webp' }, (err, data) => {
      if (err) {
        console.error('default avatar fetch failed:', err.message);
        return res.status(500).send({ error: 'Could not load the default avatar.' });
      }
      res.set('Content-Type', 'image/webp');
      res.send(data.Body);
    });
  });

  async function saveAvatar(req, res) {
    const userId = toObjectId(req.user.userId);
    if (!userId) return res.status(400).send({ error: 'Invalid token.' });
    try {
      await usersCollection.updateOne({ _id: userId }, { $set: { imageUri: req.file.location } });
      return res.status(200).send(req.file.location);
    } catch (error) {
      console.error('avatar update failed:', error.message);
      return res.status(500).send({ error: 'Could not save the avatar.' });
    }
  }

  // Sets the caller's own avatar. The target is always the authenticated user.
  router.post('/', auth, (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      if (uploadError) return res.status(uploadStatus(uploadError)).send(uploadBody(uploadError));
      if (!req.file) {
        return res
          .status(400)
          .send({ error: 'An image file (jpeg, png, webp, gif or heic) is required.' });
      }
      return saveAvatar(req, res);
    });
  });

  return router;
};

module.exports.buildObjectKey = buildObjectKey;
module.exports.imageFileFilter = imageFileFilter;
module.exports.ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_TYPES;
