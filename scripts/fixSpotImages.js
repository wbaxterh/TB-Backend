/**
 * Fix spot images - keep Google Places photos (both direct and S3 cached)
 * Only remove non-Google images (Unsplash, AI, etc)
 * Run with: node scripts/fixSpotImages.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const connectionString = process.env.ATLAS_URI;

// Check if URL is a valid Google Places photo
function isGooglePhoto(url) {
  if (!url) return false;
  // Direct Google URLs
  if (url.includes('googleusercontent.com')) return true;
  // S3 cached Google photos
  if (url.includes('trickbook') && url.includes('-google-')) return true;
  return false;
}

// Check if URL is a placeholder/AI image to remove
function isPlaceholderImage(url) {
  if (!url) return false;
  // Unsplash
  if (url.includes('unsplash.com')) return true;
  // Generic placeholders
  if (url.includes('placeholder')) return true;
  // AI generated (common patterns)
  if (url.includes('dall-e') || url.includes('midjourney')) return true;
  return false;
}

async function fixSpotImages() {
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

    let withGooglePhotos = 0;
    let withoutPhotos = 0;
    let fixed = 0;

    for (const spot of spots) {
      const currentURL = spot.imageURL;
      const hasGooglePhotosArray = spot.googlePhotos && spot.googlePhotos.length > 0;

      console.log(`\n${spot.name}:`);
      console.log(`  imageURL: ${currentURL ? `${currentURL.substring(0, 70)}...` : 'null'}`);
      console.log(
        `  googlePhotos array: ${hasGooglePhotosArray ? `${spot.googlePhotos.length} photos` : 'none'}`,
      );

      // Determine the best photo to use
      let bestPhoto = null;

      // Priority 1: Use cached S3 Google photo from googlePhotos array
      if (hasGooglePhotosArray) {
        bestPhoto = spot.googlePhotos[0].url;
        console.log(`  -> Using cached S3 Google photo`);
      }
      // Priority 2: Keep direct Google URL if it exists
      else if (isGooglePhoto(currentURL)) {
        bestPhoto = currentURL;
        console.log(`  -> Keeping direct Google URL`);
      }
      // Priority 3: Remove placeholder/non-Google images
      else if (currentURL && isPlaceholderImage(currentURL)) {
        bestPhoto = null;
        console.log(`  -> Removing placeholder image`);
      }
      // Priority 4: Current URL is something else (could be user uploaded)
      else if (currentURL) {
        bestPhoto = null; // For now, remove unknown sources
        console.log(`  -> Removing unknown source image`);
      } else {
        console.log(`  -> No image available`);
      }

      // Update if needed
      if (currentURL !== bestPhoto) {
        await spotsCollection.updateOne({ _id: spot._id }, { $set: { imageURL: bestPhoto } });
        console.log(`  => Updated imageURL`);
        fixed++;
      }

      if (bestPhoto) {
        withGooglePhotos++;
      } else {
        withoutPhotos++;
      }
    }

    console.log(`\n========================================`);
    console.log(`Done!`);
    console.log(`  With Google photos: ${withGooglePhotos}`);
    console.log(`  Without photos: ${withoutPhotos}`);
    console.log(`  Fixed: ${fixed}`);
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

fixSpotImages();
