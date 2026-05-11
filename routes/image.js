const express = require('express');
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_KEY,
  secretAccessKey: process.env.AWS_SECRET,
});

// console.log(s3);
// configure multer to use S3 for file storage
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'trickbook',
    metadata: (_req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (_req, file, cb) => {
      cb(null, `${Date.now().toString()}-${file.originalname}`);
    },
    limits: { fileSize: 25 * 1024 * 1024 },
  }),
});

//     dest: "uploads/",
//   limits: { fieldSize: 25 * 1024 * 1024 },

module.exports = (db) => {
  const router = express.Router();
  const usersCollection = db.collection('users');

  router.get('/', async (_req, res) => {
    // console.log(req.query);
    const params = {
      Bucket: 'trickbook',
      Key: 'blank-profile-picture.webp',
    };

    s3.getObject(params, (err, data) => {
      if (err) {
        console.log(err);
        res.status(500).send(err);
      } else {
        const file = data.Body;
        console.log(file);
        res.set('Content-Type', 'image/jpeg');
        res.send(file);
      }
    });
  });

  router.post('/', upload.single('file'), async (req, res) => {
    //upload.single('file'),
    // console.log(req.body.email);

    const filter2 = { email: req.body.email };
    const update = { $set: { imageUri: req.file.location } };
    try {
      const _updateResult = await usersCollection.findOneAndUpdate(filter2, update);
      return res.status(200).send(req.file.location);
    } catch (error) {
      console.log(error);
      return res.status(400).send(error);
    }
  });

  return router;
};
