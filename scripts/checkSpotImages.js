/**
 * Check current state of spot images
 * Run with: node scripts/checkSpotImages.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const connectionString = process.env.ATLAS_URI;

async function checkSpotImages() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });

    const db = client.db('TrickList2');
    const spotsCollection = db.collection('spots');

    const spots = await spotsCollection.find({}).toArray();
    console.log(`\nTotal spots: ${spots.length}\n`);

    let withImageURL = 0;
    let withGooglePhotos = 0;
    let withBoth = 0;
    let withNeither = 0;

    spots.forEach((spot) => {
      const hasImage = !!spot.imageURL;
      const hasGooglePhotos = spot.googlePhotos && spot.googlePhotos.length > 0;

      console.log(`${spot.name}:`);
      console.log(`  approvalStatus: ${spot.approvalStatus || 'none'}`);
      console.log(`  imageURL: ${hasImage ? 'yes' : 'NO'}`);
      console.log(`  googlePhotos: ${hasGooglePhotos ? spot.googlePhotos.length : 'NO'}`);

      if (hasImage && hasGooglePhotos) withBoth++;
      else if (hasImage) withImageURL++;
      else if (hasGooglePhotos) withGooglePhotos++;
      else withNeither++;
    });

    console.log(`\n========================================`);
    console.log(`Summary:`);
    console.log(`  With both imageURL and googlePhotos: ${withBoth}`);
    console.log(`  With only imageURL: ${withImageURL}`);
    console.log(`  With only googlePhotos: ${withGooglePhotos}`);
    console.log(`  With neither: ${withNeither}`);
    console.log(`========================================\n`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

checkSpotImages();
