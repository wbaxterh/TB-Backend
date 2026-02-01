/**
 * Fetch Google Places photos for specific spots with custom search terms
 * Run with: node scripts/fetchMissingPhotos.js
 */

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const googlePlaces = require("../services/googlePlaces");

const connectionString = process.env.ATLAS_URI;

// Custom search terms for spots that didn't match
const customSearches = [
  {
    name: "Thunder Ridge Ski Area",
    searchTerms: ["Thunder Ridge", "Thunder Ridge Ski"],
    radius: 1000,
  },
  {
    name: "Powder Ridge Mountain Park",
    searchTerms: ["Powder Ridge", "Powder Ridge Mountain", "Powder Ridge Park"],
    radius: 1000,
  },
];

async function fetchMissingPhotos() {
  let client;

  try {
    console.log("Connecting to MongoDB...");
    client = await MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });

    const db = client.db("TrickList2");
    const spotsCollection = db.collection("spots");

    for (const search of customSearches) {
      const spot = await spotsCollection.findOne({ name: search.name });

      if (!spot) {
        console.log(`Spot not found: ${search.name}`);
        continue;
      }

      if (spot.googlePhotos && spot.googlePhotos.length > 0) {
        console.log(`${search.name} already has photos, skipping`);
        continue;
      }

      console.log(`\nProcessing: "${spot.name}"`);

      for (const term of search.searchTerms) {
        console.log(`  Trying search term: "${term}"`);

        const place = await googlePlaces.findPlaceByNameAndLocation(
          term,
          spot.latitude,
          spot.longitude,
          search.radius
        );

        if (place) {
          console.log(`  Found place: ${place.name}`);

          const placeData = await googlePlaces.fetchAndCachePlaceData(
            term,
            spot.latitude,
            spot.longitude,
            spot._id.toString(),
            5
          );

          if (placeData.found && placeData.googlePhotos.length > 0) {
            await spotsCollection.updateOne(
              { _id: spot._id },
              {
                $set: {
                  googlePlaceId: placeData.placeId,
                  googlePhotos: placeData.googlePhotos,
                  googlePlaceData: placeData.placeData,
                  googlePlacesCachedAt: new Date(),
                  imageURL: placeData.googlePhotos[0].url,
                },
              }
            );

            console.log(`  ✓ Found ${placeData.googlePhotos.length} photos!`);
            break; // Success, move to next spot
          }
        } else {
          console.log(`  No match for "${term}"`);
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    console.log("\nDone!");

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

fetchMissingPhotos();
