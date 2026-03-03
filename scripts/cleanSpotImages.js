/**
 * Clean spot images - remove AI/placeholder images, only use Google Places photos
 * Run with: node scripts/cleanSpotImages.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const connectionString = process.env.ATLAS_URI;

async function cleanSpotImages() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });

    const db = client.db('TrickList2');
    const spotsCollection = db.collection('spots');

    // Get all spots
    const spots = await spotsCollection.find({}).toArray();
    console.log(`\nFound ${spots.length} total spots\n`);

    let updatedCount = 0;
    let googlePhotoCount = 0;
    let noPhotoCount = 0;

    for (const spot of spots) {
      const hasGooglePhotos = spot.googlePhotos && spot.googlePhotos.length > 0;
      const currentImageURL = spot.imageURL || '';

      // Check if current image is NOT from Google (S3 bucket with google in filename)
      const isGooglePhoto =
        currentImageURL.includes('trickbook-media') && currentImageURL.includes('-google-');

      console.log(`\n${spot.name}:`);
      console.log(
        `  Current imageURL: ${currentImageURL ? `${currentImageURL.substring(0, 60)}...` : 'none'}`,
      );
      console.log(`  Has Google Photos: ${hasGooglePhotos} (${spot.googlePhotos?.length || 0})`);
      console.log(`  Current image is Google: ${isGooglePhoto}`);

      if (hasGooglePhotos) {
        // Use the first Google photo as the main image
        const newImageURL = spot.googlePhotos[0].url;

        if (currentImageURL !== newImageURL) {
          await spotsCollection.updateOne({ _id: spot._id }, { $set: { imageURL: newImageURL } });
          console.log(`  -> Updated to Google photo`);
          updatedCount++;
        } else {
          console.log(`  -> Already using Google photo`);
        }
        googlePhotoCount++;
      } else {
        // No Google photos - remove any placeholder/AI image
        if (currentImageURL && !isGooglePhoto) {
          await spotsCollection.updateOne({ _id: spot._id }, { $set: { imageURL: null } });
          console.log(`  -> Removed non-Google image`);
          updatedCount++;
        } else {
          console.log(`  -> No changes needed`);
        }
        noPhotoCount++;
      }
    }

    console.log(`\n========================================`);
    console.log(`Done!`);
    console.log(`  Spots with Google photos: ${googlePhotoCount}`);
    console.log(`  Spots without Google photos: ${noPhotoCount}`);
    console.log(`  Updated: ${updatedCount}`);
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

cleanSpotImages();
