const express = require('express');
const router = express.Router();
const Joi = require('joi');
const axios = require('axios');
const { MongoClient, ObjectId } = require('mongodb');
const validateWith = require('../middleware/validation');
const auth = require('../middleware/auth');
const authAdmin = require('../middleware/authAdmin');
const multer = require('multer');
const googlePlaces = require('../services/googlePlaces');
const s3Upload = require('../services/s3Upload');
const connectionString = process.env.ATLAS_URI;

// Configure multer for memory storage (for S3 upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Sport types for filtering
const SPORT_TYPES = [
  'skateboarding',
  'snowboarding',
  'skiing',
  'bmx',
  'mtb',
  'scooter',
  'rollerblading',
  'surfing',
  'wakeboarding',
];

const schema = {
  name: Joi.string().required(),
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  imageURL: Joi.string().uri().allow('').allow(null).optional(),
  description: Joi.string().allow('').optional(),
  rating: Joi.number().min(0).max(5).optional(),
  tags: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  state: Joi.string().allow('').optional(),
  country: Joi.string().allow('').optional(),
  isPublic: Joi.boolean().optional(),
  sportTypes: Joi.array()
    .items(Joi.string().valid(...SPORT_TYPES))
    .optional(),
  category: Joi.string().valid('park', 'street', 'indoor', 'diy', 'other').optional(),
};

const updateSchema = {
  name: Joi.string().optional(),
  latitude: Joi.number().optional(),
  longitude: Joi.number().optional(),
  imageURL: Joi.string().uri().allow('').allow(null).optional(),
  description: Joi.string().allow('').optional(),
  rating: Joi.number().min(0).max(5).optional(),
  tags: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  state: Joi.string().allow('').optional(),
  country: Joi.string().allow('').optional(),
  isPublic: Joi.boolean().optional(),
  sportTypes: Joi.array()
    .items(Joi.string().valid(...SPORT_TYPES))
    .optional(),
  category: Joi.string().valid('park', 'street', 'indoor', 'diy', 'other').optional(),
};

const approvalSchema = {
  status: Joi.string().valid('approved', 'rejected').required(),
  rejectionReason: Joi.string().allow('').optional(),
};

// Get available sport types - defined outside MongoDB callback since it doesn't need DB
router.get('/sport-types', (_req, res) => {
  res.json({
    sportTypes: SPORT_TYPES.map((sport) => ({
      value: sport,
      label: sport.charAt(0).toUpperCase() + sport.slice(1),
    })),
  });
});

// Search Google Places for autocomplete/location finding
// GET /api/spots/places-search?query=skatepark&lat=40.7&lng=-74
router.get('/places-search', auth, async (req, res) => {
  const { query, lat, lng } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const latitude = lat ? parseFloat(lat) : null;
    const longitude = lng ? parseFloat(lng) : null;

    // Use the Google Places text search
    let results = [];

    if (latitude && longitude) {
      // Search near the provided location
      const place = await googlePlaces.findPlaceByTextSearch(query, latitude, longitude, 50000);
      if (place) {
        // Get full details for the place
        const details = await googlePlaces.getPlaceDetails(place.place_id);
        results.push({
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address || place.vicinity,
          latitude: place.geometry?.location?.lat,
          longitude: place.geometry?.location?.lng,
          rating: details?.rating,
          types: place.types,
          photos:
            details?.photos?.slice(0, 3).map((p) => ({
              reference: p.photo_reference,
            })) || [],
        });
      }
    } else {
      // General text search without location bias
      const response = await axios.get(
        `https://maps.googleapis.com/maps/api/place/textsearch/json`,
        {
          params: {
            query: query,
            key: process.env.GOOGLE_PLACES_API_KEY,
          },
        },
      );

      if (response.data.results) {
        results = response.data.results.slice(0, 10).map((place) => ({
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address,
          latitude: place.geometry?.location?.lat,
          longitude: place.geometry?.location?.lng,
          rating: place.rating,
          types: place.types,
        }));
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Places search error:', error.message);
    res.status(500).json({ error: 'Failed to search places' });
  }
});

// Get place details by placeId
// GET /api/spots/places/:placeId
router.get('/places/:placeId', auth, async (req, res) => {
  const { placeId } = req.params;

  if (!placeId) {
    return res.status(400).json({ error: 'Place ID is required' });
  }

  try {
    const details = await googlePlaces.getPlaceDetails(placeId);

    if (!details) {
      return res.status(404).json({ error: 'Place not found' });
    }

    res.json({
      placeId: placeId,
      name: details.name,
      address: details.formatted_address,
      latitude: details.geometry?.location?.lat,
      longitude: details.geometry?.location?.lng,
      rating: details.rating,
      reviewCount: details.user_ratings_total,
      types: details.types,
      openingHours: details.opening_hours,
      photos:
        details.photos?.slice(0, 5).map((p) => ({
          reference: p.photo_reference,
          attribution: p.html_attributions?.[0],
        })) || [],
    });
  } catch (error) {
    console.error('Place details error:', error.message);
    res.status(500).json({ error: 'Failed to get place details' });
  }
});

// Reverse geocode coordinates to get address
// GET /api/spots/reverse-geocode?lat=40.7&lng=-74
router.get('/reverse-geocode', auth, async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng parameters are required' });
  }

  try {
    const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
      params: {
        latlng: `${lat},${lng}`,
        key: process.env.GOOGLE_PLACES_API_KEY,
      },
    });

    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];

      // Extract city and state from address components
      let city = '';
      let state = '';
      let country = '';

      for (const component of result.address_components || []) {
        if (component.types.includes('locality')) {
          city = component.long_name;
        } else if (component.types.includes('administrative_area_level_1')) {
          state = component.short_name;
        } else if (component.types.includes('country')) {
          country = component.short_name;
        }
      }

      res.json({
        address: result.formatted_address,
        city,
        state,
        country,
        placeId: result.place_id,
      });
    } else {
      res.json({ address: null, city: '', state: '', country: '' });
    }
  } catch (error) {
    console.error('Reverse geocode error:', error.message);
    res.status(500).json({ error: 'Failed to reverse geocode' });
  }
});

MongoClient.connect(connectionString, { useUnifiedTopology: true })
  .then((client) => {
    const db = client.db('TrickList2');
    const spotsCollection = db.collection('spots');
    const spotListsCollection = db.collection('spotlists');

    // Create a new spot
    router.post('/', [auth, validateWith(schema)], async (req, res) => {
      const {
        name,
        latitude,
        longitude,
        imageURL,
        description,
        rating,
        tags,
        city,
        state,
        isPublic,
        sportTypes,
        category,
      } = req.body;

      // Check if spot already exists by lat/long
      const existingSpot = await spotsCollection.findOne({
        latitude: latitude,
        longitude: longitude,
      });

      if (existingSpot) {
        return res.status(200).json(existingSpot);
      }

      // Determine approval status based on isPublic flag
      let approvalStatus = 'private';
      if (isPublic === true) {
        approvalStatus = 'pending';
      }

      const spot = {
        name,
        latitude,
        longitude,
        imageURL: imageURL || null,
        description: description || '',
        rating: rating || null,
        tags: tags || '',
        city: city || '',
        state: state || '',
        isPublic: isPublic || false,
        sportTypes: sportTypes || [],
        category: category || 'other',
        approvalStatus,
        userId: new ObjectId(req.user.userId),
        createdAt: new Date(),
      };

      // Add submittedAt if submitted for public approval
      if (isPublic === true) {
        spot.submittedAt = new Date();
      }

      try {
        const result = await spotsCollection.insertOne(spot);
        spot._id = result.insertedId;
        res.status(201).json(spot);
      } catch (error) {
        console.error('Error creating spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Bulk insert spots
    router.post('/bulk', [auth], async (req, res) => {
      const { parks } = req.body;
      if (!Array.isArray(parks) || parks.length === 0) {
        return res.status(400).json({ error: 'parks must be a non-empty array' });
      }
      // Validate each spot (reuse schema)
      const invalid = parks.find((spot) => {
        const { error } = Joi.validate(spot, schema);
        return error;
      });
      if (invalid) {
        return res.status(400).json({ error: 'One or more spots are invalid' });
      }
      try {
        const processedSpots = [];

        for (const park of parks) {
          // Check if spot already exists by lat/long
          const existingSpot = await spotsCollection.findOne({
            latitude: park.latitude,
            longitude: park.longitude,
          });

          if (existingSpot) {
            processedSpots.push(existingSpot);
          } else {
            // Insert new spot
            const result = await spotsCollection.insertOne(park);
            const newSpot = { ...park, _id: result.insertedId };
            processedSpots.push(newSpot);
          }
        }

        res.status(201).json(processedSpots);
      } catch (error) {
        console.error('Error bulk inserting spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get all approved public spots with pagination and filtering
    router.get('/', async (req, res) => {
      try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const skip = (page - 1) * limit;
        const sort = req.query.sort || 'name';
        const order = req.query.order === 'desc' ? -1 : 1;
        const { sportType, category, q, country } = req.query;

        // Only return approved public spots for public API
        const query = { approvalStatus: 'approved' };

        // Filter by country
        if (country && country !== 'all') {
          query.country = country;
        }

        // Filter by sport type
        if (sportType && sportType !== 'all') {
          query.sportTypes = sportType;
        }

        // Filter by category (park, street, indoor, diy)
        if (category && category !== 'all') {
          query.category = category;
        }

        // Search by name
        if (q) {
          query.name = { $regex: q, $options: 'i' };
        }

        const totalCount = await spotsCollection.countDocuments(query);
        const spots = await spotsCollection
          .find(query)
          .sort({ [sort]: order })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          spots,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          },
        });
      } catch (error) {
        console.error('Error retrieving spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get all spots (including unapproved) - Admin only
    router.get('/all', [authAdmin()], async (req, res) => {
      try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const skip = (page - 1) * limit;
        const sort = req.query.sort || 'name';
        const order = req.query.order === 'desc' ? -1 : 1;

        const totalCount = await spotsCollection.countDocuments();
        const spots = await spotsCollection
          .find()
          .sort({ [sort]: order })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          spots,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          },
        });
      } catch (error) {
        console.error('Error retrieving all spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get pending spots for admin review
    router.get('/pending', [authAdmin()], async (req, res) => {
      try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const skip = (page - 1) * limit;

        const query = { approvalStatus: 'pending' };

        const totalCount = await spotsCollection.countDocuments(query);
        const spots = await spotsCollection
          .find(query)
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          spots,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          },
        });
      } catch (error) {
        console.error('Error retrieving pending spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Search spots with filters (only approved spots)
    router.get('/search', async (req, res) => {
      try {
        const { q, city, state, tags } = req.query;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const skip = (page - 1) * limit;

        // Only search approved spots for public API
        const query = { approvalStatus: 'approved' };

        // Text search on name
        if (q) {
          query.name = { $regex: q, $options: 'i' };
        }

        // Filter by city
        if (city) {
          query.city = { $regex: city, $options: 'i' };
        }

        // Filter by state
        if (state) {
          query.state = { $regex: `^${state}$`, $options: 'i' };
        }

        // Filter by tags (comma-separated)
        if (tags) {
          const tagList = tags.split(',').map((t) => t.trim());
          query.tags = {
            $regex: tagList.map((t) => `(?=.*${t})`).join(''),
            $options: 'i',
          };
        }

        const totalCount = await spotsCollection.countDocuments(query);
        const spots = await spotsCollection
          .find(query)
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          spots,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          },
        });
      } catch (error) {
        console.error('Error searching spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get user's own spots (all statuses)
    router.get('/my-spots', [auth], async (req, res) => {
      try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const skip = (page - 1) * limit;

        const query = { userId: new ObjectId(req.user.userId) };

        const totalCount = await spotsCollection.countDocuments(query);
        const spots = await spotsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          spots,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: page * limit < totalCount,
          },
        });
      } catch (error) {
        console.error('Error retrieving user spots', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get a single spot by ID
    router.get('/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }
      try {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }
        res.status(200).json(spot);
      } catch (error) {
        console.error('Error retrieving spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Update a spot
    router.put('/:id', [auth, validateWith(updateSchema)], async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      const {
        name,
        latitude,
        longitude,
        imageURL,
        description,
        rating,
        tags,
        city,
        state,
        sportTypes,
        category,
      } = req.body;

      // Build update object with only provided fields
      const updateFields = {};
      if (name !== undefined) updateFields.name = name;
      if (latitude !== undefined) updateFields.latitude = latitude;
      if (longitude !== undefined) updateFields.longitude = longitude;
      if (imageURL !== undefined) updateFields.imageURL = imageURL;
      if (description !== undefined) updateFields.description = description;
      if (rating !== undefined) updateFields.rating = rating;
      if (tags !== undefined) updateFields.tags = tags;
      if (city !== undefined) updateFields.city = city;
      if (state !== undefined) updateFields.state = state;
      if (sportTypes !== undefined) updateFields.sportTypes = sportTypes;
      if (category !== undefined) updateFields.category = category;
      updateFields.updatedAt = new Date();

      try {
        const result = await spotsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        const updatedSpot = await spotsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.status(200).json(updatedSpot);
      } catch (error) {
        console.error('Error updating spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Approve a spot (admin only)
    router.put('/:id/approve', [authAdmin(), validateWith(approvalSchema)], async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      try {
        const updateFields = {
          approvalStatus: 'approved',
          reviewedAt: new Date(),
          reviewedBy: new ObjectId(req.user.userId),
          updatedAt: new Date(),
        };

        const result = await spotsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        const updatedSpot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        res.status(200).json(updatedSpot);
      } catch (error) {
        console.error('Error approving spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Reject a spot (admin only)
    router.put('/:id/reject', [authAdmin(), validateWith(approvalSchema)], async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      const { rejectionReason } = req.body;

      try {
        const updateFields = {
          approvalStatus: 'rejected',
          rejectionReason: rejectionReason || '',
          reviewedAt: new Date(),
          reviewedBy: new ObjectId(req.user.userId),
          updatedAt: new Date(),
        };

        const result = await spotsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        const updatedSpot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        res.status(200).json(updatedSpot);
      } catch (error) {
        console.error('Error rejecting spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Delete a spot (admin only)
    router.delete('/:id', [authAdmin()], async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      try {
        // First, remove the spot from all spot lists
        await spotListsCollection.updateMany(
          { spotIds: new ObjectId(id) },
          { $pull: { spotIds: new ObjectId(id) } },
        );

        // Then delete the spot
        const result = await spotsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        res.status(200).json({ message: 'Spot deleted successfully' });
      } catch (error) {
        console.error('Error deleting spot', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    // Get lists containing a specific spot
    router.get('/:id/lists', [auth], async (req, res) => {
      const spotId = req.params.id;
      if (!ObjectId.isValid(spotId)) {
        return res.status(400).json({ error: 'Invalid spot ID' });
      }
      try {
        const spotLists = await spotListsCollection
          .find({
            spotIds: new ObjectId(spotId),
            userId: req.user.userId,
          })
          .toArray();
        res.status(200).json(spotLists);
      } catch (error) {
        console.error('Error retrieving spot lists', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    /**
     * GET /api/spots/:id/places-info
     * Fetch and cache Google Places data for a spot
     */
    router.get('/:id/places-info', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      try {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        // Check if we already have cached Google Places data (cache for 30 days)
        const cacheAge = spot.googlePlacesCachedAt
          ? Date.now() - new Date(spot.googlePlacesCachedAt).getTime()
          : Infinity;
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        if (spot.googlePlaceId && spot.googlePhotos && cacheAge < thirtyDays) {
          return res.json({
            cached: true,
            placeId: spot.googlePlaceId,
            googlePhotos: spot.googlePhotos,
            placeData: spot.googlePlaceData,
          });
        }

        // Fetch from Google Places API
        const placeData = await googlePlaces.fetchAndCachePlaceData(
          spot.name,
          spot.latitude,
          spot.longitude,
          id.toString(),
          5, // max 5 photos
        );

        if (!placeData.found) {
          return res.json({ found: false, message: 'No matching place found on Google' });
        }

        // Update spot with cached data
        await spotsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              googlePlaceId: placeData.placeId,
              googlePhotos: placeData.googlePhotos,
              googlePlaceData: placeData.placeData,
              googlePlacesCachedAt: new Date(),
            },
          },
        );

        res.json({
          cached: false,
          placeId: placeData.placeId,
          googlePhotos: placeData.googlePhotos,
          placeData: placeData.placeData,
        });
      } catch (error) {
        console.error('Error fetching places info:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    /**
     * GET /api/spots/:id/photos
     * Get all photos for a spot (Google + user uploaded)
     */
    router.get('/:id/photos', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      try {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        const photos = {
          googlePhotos: spot.googlePhotos || [],
          userPhotos: spot.userPhotos || [],
          mainImage: spot.imageURL,
        };

        res.json(photos);
      } catch (error) {
        console.error('Error fetching photos:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    /**
     * POST /api/spots/:id/photos
     * Upload a user photo for a spot
     */
    router.post('/:id/photos', [auth, upload.single('photo')], async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No photo provided' });
      }

      try {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        // Upload to S3
        const fileName = `${id}-user-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
        const result = await s3Upload.uploadFile(
          req.file.buffer,
          fileName,
          req.file.mimetype,
          'spots',
        );

        const newPhoto = {
          url: result.fileUrl,
          key: result.fileKey,
          userId: req.user.userId,
          uploadedAt: new Date(),
        };

        // Add to userPhotos array
        await spotsCollection.updateOne({ _id: new ObjectId(id) }, { $push: { userPhotos: newPhoto } });

        console.log(`[Spots] User ${req.user.userId} uploaded photo for spot ${id}`);

        res.status(201).json(newPhoto);
      } catch (error) {
        console.error('Error uploading photo:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

    /**
     * DELETE /api/spots/:id/photos/:photoKey
     * Delete a user-uploaded photo (only owner or admin)
     */
    router.delete('/:id/photos/:photoKey', [auth], async (req, res) => {
      const { id, photoKey } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      try {
        const spot = await spotsCollection.findOne({ _id: new ObjectId(id) });
        if (!spot) {
          return res.status(404).json({ error: 'Spot not found' });
        }

        // Find the photo
        const photo = (spot.userPhotos || []).find((p) => p.key === photoKey);
        if (!photo) {
          return res.status(404).json({ error: 'Photo not found' });
        }

        // Check authorization (owner or admin)
        if (photo.userId !== req.user.userId && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Not authorized to delete this photo' });
        }

        // Delete from S3
        await s3Upload.deleteFile(photoKey);

        // Remove from userPhotos array
        await spotsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $pull: { userPhotos: { key: photoKey } } },
        );

        console.log(`[Spots] Photo ${photoKey} deleted from spot ${id}`);

        res.json({ message: 'Photo deleted successfully' });
      } catch (error) {
        console.error('Error deleting photo:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB', error);
  });

module.exports = router;
