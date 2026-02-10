/**
 * Fetch Google Places photos for all spots
 * Run with: node scripts/fetchSpotPhotos.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const googlePlaces = require('../services/googlePlaces');

const connectionString = process.env.ATLAS_URI;

async function fetchSpotPhotos() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });

    const db = client.db('TrickList2');
    const spotsCollection = db.collection('spots');

    // Get all approved spots that don't have Google photos yet
    const spots = await spotsCollection
      .find({
        approvalStatus: 'approved',
        $or: [
          { googlePhotos: { $exists: false } },
          { googlePhotos: { $size: 0 } },
          { googlePhotos: null },
        ],
      })
      .toArray();

    console.log(`\nFound ${spots.length} spots without Google photos\n`);

    let successCount = 0;
    let failCount = 0;

    for (const spot of spots) {
      console.log(`Processing: "${spot.name}" (${spot.city}, ${spot.state})`);

      try {
        const placeData = await googlePlaces.fetchAndCachePlaceData(
          spot.name,
          spot.latitude,
          spot.longitude,
          spot._id.toString(),
          5, // max 5 photos
        );

        if (placeData.found && placeData.googlePhotos.length > 0) {
          // Update spot with Google photos
          await spotsCollection.updateOne(
            { _id: spot._id },
            {
              $set: {
                googlePlaceId: placeData.placeId,
                googlePhotos: placeData.googlePhotos,
                googlePlaceData: placeData.placeData,
                googlePlacesCachedAt: new Date(),
                // Also set the main imageURL if it's not set
                ...((!spot.imageURL || spot.imageURL.includes('unsplash')) &&
                placeData.googlePhotos[0]
                  ? { imageURL: placeData.googlePhotos[0].url }
                  : {}),
              },
            },
          );

          console.log(`  ✓ Found ${placeData.googlePhotos.length} photos`);
          successCount++;
        } else {
          console.log(`  ✗ No matching place found on Google`);
          failCount++;
        }
      } catch (error) {
        console.log(`  ✗ Error: ${error.message}`);
        failCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`\n========================================`);
    console.log(`Done!`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Failed/Not found: ${failCount}`);
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

fetchSpotPhotos();
