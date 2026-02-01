/**
 * Google Places Service
 * Handles Google Places API integration for spot photos and details
 */

const axios = require("axios");
const s3Upload = require("./s3Upload");

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE_URL = "https://maps.googleapis.com/maps/api/place";

/**
 * Search for a place by name near coordinates
 * Uses Places API Nearby Search
 */
async function findPlaceByNameAndLocation(name, latitude, longitude, radius = 500) {
	if (!PLACES_API_KEY) {
		console.warn("Google Places API key not configured");
		return null;
	}

	try {
		const response = await axios.get(`${PLACES_BASE_URL}/nearbysearch/json`, {
			params: {
				location: `${latitude},${longitude}`,
				radius: radius,
				keyword: name,
				key: PLACES_API_KEY,
			},
		});

		if (response.data.results && response.data.results.length > 0) {
			return response.data.results[0]; // Best match
		}
		return null;
	} catch (error) {
		console.error("Google Places search error:", error.message);
		return null;
	}
}

/**
 * Search for a place using text search (more flexible)
 * Uses Places API Text Search
 */
async function findPlaceByTextSearch(query, latitude, longitude, radius = 5000) {
	if (!PLACES_API_KEY) {
		console.warn("Google Places API key not configured");
		return null;
	}

	try {
		const response = await axios.get(`${PLACES_BASE_URL}/textsearch/json`, {
			params: {
				query: query,
				location: `${latitude},${longitude}`,
				radius: radius,
				key: PLACES_API_KEY,
			},
		});

		if (response.data.results && response.data.results.length > 0) {
			return response.data.results[0]; // Best match
		}
		return null;
	} catch (error) {
		console.error("Google Places text search error:", error.message);
		return null;
	}
}

/**
 * Get place details including photos
 */
async function getPlaceDetails(placeId) {
	if (!PLACES_API_KEY) {
		console.warn("Google Places API key not configured");
		return null;
	}

	try {
		const response = await axios.get(`${PLACES_BASE_URL}/details/json`, {
			params: {
				place_id: placeId,
				fields: "name,formatted_address,photos,geometry,rating,user_ratings_total,types,opening_hours",
				key: PLACES_API_KEY,
			},
		});
		return response.data.result;
	} catch (error) {
		console.error("Google Places details error:", error.message);
		return null;
	}
}

/**
 * Get a photo URL from Google Places
 */
function getPlacePhotoUrl(photoReference, maxWidth = 800) {
	return `${PLACES_BASE_URL}/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${PLACES_API_KEY}`;
}

/**
 * Fetch a Google Place photo and cache it to S3
 * This avoids repeated API calls and provides consistent URLs
 */
async function fetchAndCachePhoto(photoReference, spotId) {
	if (!PLACES_API_KEY) {
		console.warn("Google Places API key not configured");
		return null;
	}

	const photoUrl = getPlacePhotoUrl(photoReference, 800);

	try {
		const response = await axios.get(photoUrl, { responseType: "arraybuffer" });
		const buffer = Buffer.from(response.data);

		// Upload to S3 in spots folder
		const result = await s3Upload.uploadFile(
			buffer,
			`${spotId}-google-${Date.now()}.jpg`,
			"image/jpeg",
			"spots"
		);

		return result.fileUrl;
	} catch (error) {
		console.error("Error caching Google photo:", error.message);
		return null;
	}
}

/**
 * Fetch place data and cache photos for a spot
 * Returns cached photo URLs and place ID
 */
async function fetchAndCachePlaceData(spotName, latitude, longitude, spotId, maxPhotos = 5) {
	// Try nearby search first
	let place = await findPlaceByNameAndLocation(spotName, latitude, longitude);

	// Fall back to text search if nearby search fails
	if (!place) {
		place = await findPlaceByTextSearch(spotName, latitude, longitude);
	}

	if (!place) {
		return { found: false };
	}

	// Get place details for photos
	const details = await getPlaceDetails(place.place_id);
	if (!details) {
		return {
			found: true,
			placeId: place.place_id,
			googlePhotos: [],
		};
	}

	// Cache photos
	const googlePhotos = [];
	if (details.photos && details.photos.length > 0) {
		for (const photo of details.photos.slice(0, maxPhotos)) {
			const cachedUrl = await fetchAndCachePhoto(photo.photo_reference, spotId);
			if (cachedUrl) {
				googlePhotos.push({
					url: cachedUrl,
					attribution: photo.html_attributions?.[0] || "",
				});
			}
		}
	}

	return {
		found: true,
		placeId: place.place_id,
		googlePhotos,
		placeData: {
			name: details.name,
			address: details.formatted_address,
			googleRating: details.rating,
			googleReviewCount: details.user_ratings_total,
			types: details.types,
		},
	};
}

module.exports = {
	findPlaceByNameAndLocation,
	findPlaceByTextSearch,
	getPlaceDetails,
	getPlacePhotoUrl,
	fetchAndCachePhoto,
	fetchAndCachePlaceData,
};
