// schemas/collections/spots.js
// Derived from the write sites listed under `writers`; see schemas/README.md.

const id = { bsonType: 'objectId' };
const str = { bsonType: 'string' };
const strOrNull = { bsonType: ['string', 'null'] };
const date = { bsonType: 'date' };
const counter = { bsonType: 'int' };
const strArray = { bsonType: 'array', items: str };

// Mirrors SPORT_TYPES, SPOT_CATEGORY_IDS and PARK_TYPE_IDS in routes/spots.js,
// which Joi enforces on POST /, PUT /:id and POST /bulk.
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
const SPOT_CATEGORIES = ['park', 'street', 'backcountry', 'indoor', 'diy', 'resort', 'other'];
const PARK_TYPES = [
  'skatepark',
  'terrain_park',
  'cable_park',
  'bmx_park',
  'bike_park',
  'pump_track',
  'dirt_jumps',
  'surf_park',
  'other',
];

module.exports = {
  spots: {
    description:
      'A riding location (park, street, resort...) with flat lat/lng, a moderation status, and cached Google Places media.',
    writers: [
      'routes/spots.js',
      'routes/spotReviews.js',
      'scripts/seedSpots.js',
      'scripts/fetchSpotPhotos.js',
      'scripts/fetchAllSpotPhotos.js',
      'scripts/fetchMissingPhotos.js',
      'scripts/fixSpotImages.js',
      'scripts/cleanSpotImages.js',
    ],
    jsonSchema: {
      bsonType: 'object',
      required: ['name', 'latitude', 'longitude'],
      properties: {
        _id: id,
        name: str,
        latitude: { bsonType: 'number' },
        longitude: { bsonType: 'number' },
        imageURL: strOrNull,
        description: str,
        rating: { bsonType: ['number', 'null'], minimum: 0, maximum: 5 },
        tags: str,
        city: str,
        state: str,
        country: str,
        isPublic: { bsonType: 'bool' },
        sportTypes: { bsonType: 'array', items: { enum: SPORT_TYPES } },
        category: { enum: SPOT_CATEGORIES },
        parkType: { bsonType: ['string', 'null'], enum: [...PARK_TYPES, '', null] },
        website: str,
        approvalStatus: { enum: ['private', 'pending', 'approved', 'rejected'] },
        userId: id,
        createdAt: date,
        updatedAt: date,
        submittedAt: date,
        reviewedAt: date,
        reviewedBy: id,
        rejectionReason: str,
        reviewCount: counter,
        googlePlaceId: str,
        googlePhotos: {
          bsonType: 'array',
          items: { bsonType: 'object', properties: { url: str, attribution: str } },
        },
        googlePlaceData: {
          bsonType: 'object',
          properties: {
            name: str,
            address: str,
            googleRating: { bsonType: 'number' },
            googleReviewCount: { bsonType: 'number' },
            types: strArray,
          },
        },
        googlePlacesCachedAt: date,
        userPhotos: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              url: str,
              key: str,
              userId: str,
              uploadedAt: date,
              reportedBy: strArray,
              hidden: { bsonType: 'bool' },
            },
          },
        },
        aliases: strArray,
        location: { bsonType: 'object' },
        type: str,
        features: { bsonType: 'array' },
        address: str,
      },
    },
    notes: [
      'Insert sites: routes/spots.js POST / (Joi schema; full shape with userId ObjectId, approvalStatus, createdAt); routes/spots.js POST /bulk (each Joi-validated `park` inserted verbatim, so no userId, approvalStatus or createdAt unless the client sends them, which is why only name, latitude and longitude are required); scripts/seedSpots.js (six approved NY/CT rows, no userId). Every insert dedupes with findOne({ latitude, longitude }) on exact equality.',
      '$set sites: routes/spots.js PUT /:id (owner or admin; provided fields + updatedAt), PUT /:id/approve and /:id/reject (approvalStatus, reviewedAt, reviewedBy ObjectId, rejectionReason, updatedAt), GET /:id/places-info (a GET that writes googlePlaceId, googlePhotos, googlePlaceData, googlePlacesCachedAt), POST/DELETE /:id/photos ($push/$pull userPhotos), POST /:id/photos/:photoKey/report ($addToSet userPhotos.$[p].reportedBy, then $set userPhotos.$[p].hidden). routes/spotReviews.js updateSpotRating writes rating (1-decimal average or null) and reviewCount. Scripts fetchSpotPhotos/fetchAllSpotPhotos/fetchMissingPhotos $set the Google cache fields and imageURL; fixSpotImages and cleanSpotImages $set imageURL to a Google URL or null.',
      'userId: only routes/spots.js POST / writes it, as new ObjectId(req.user.userId). routes/user.js counts and lists spots by ObjectId; routes/spots.js compares String(spot.userId) === String(req.user.userId). Bulk and seed rows have no owner, so only admins can edit or delete them. userPhotos[].userId is the JWT string (photo ownership compares strings), and reviewedBy is an ObjectId.',
      'latitude/longitude: plain numbers (Joi.number on every route insert, literals in seeds), not GeoJSON; no `location` point is written. The only index created in code is { approvalStatus: 1, latitude: 1, longitude: 1 } at router init; GET /map-pins does bounding-box range queries with an antimeridian split. No 2dsphere index. MONGODB_COLLECTIONS_SETUP.md suggests { latitude, longitude } and a text index; neither is created by code.',
      'country: accepted by both Joi schemas but never destructured in POST / or PUT /:id, so it only reaches the database through POST /bulk passthrough; GET / filters by it. Legacy read only for route-created spots.',
      'rating: POST / writes body rating || null (a 0 becomes null). routes/spotReviews.js replaces it with the average of status "active" reviews whenever a review is created, edited or soft-deleted, and sets reviewCount, so a hand-entered rating survives only until the first review.',
      'sportTypes, category, parkType: enums mirror SPORT_TYPES, SPOT_CATEGORY_IDS and PARK_TYPE_IDS in routes/spots.js, enforced by Joi on POST /, PUT /:id and POST /bulk; seeds comply. category defaults to "other", parkType to null ("" is also allowed). parkType only means something when category is "park", or "resort" with "terrain_park", which the "park" filter also surfaces.',
      'approvalStatus: "private" unless isPublic is true at insert ("pending", plus submittedAt); admins move it to "approved" or "rejected". Public reads (GET /, /search, /map-pins, kaori search_spots, mcp get_spot) require "approved"; GET /:id hides non-approved spots from non-owners. Seeds insert "approved" directly.',
      'googlePhotos[]: { url, attribution } where url is an S3 copy made by services/googlePlaces.js fetchAndCachePhoto and attribution is Google html_attributions[0]. googlePlaceData is { name, address, googleRating, googleReviewCount, types }. Cache is refreshed after 30 days by googlePlacesCachedAt.',
      'userPhotos[]: { url, key (S3 key), userId, uploadedAt }; reportedBy[] and hidden are added by the report route, hidden flipping to true at 3 distinct reporters. GET /:id and /:id/photos filter hidden; DELETE /:id deletes the S3 objects.',
      'aliases, location, type, features, address: legacy read only. companion-graph/graph.js findSpot matches aliases; kaori-rag/documents.js spotDocument reads location.{city,state,country}, type, features and address. No writer in this repo sets them; they describe an older spot shape.',
      'Deleted by DELETE /:id (owner or admin) after $pull from every spotlists.spotIds; spot_reviews and spot_trick_history rows for the spot are not cleaned up.',
      'Readers: routes/listing.js populateSpotData, routes/spotlists.js, routes/spotReviews.js, routes/feed.js (post enrichment), routes/user.js, kaori-tools.js searchSpots, mcp/public-tools.js getSpot, routes/stats.js, routes/analytics.js, scripts/index-kaori-rag.js, scripts/checkSpotImages.js, scripts/query-companion-graph.js.',
    ],
  },

  spotlists: {
    description:
      'A user-named collection of spot refs (and optional trick refs); one hidden isDefaultSaved bucket per user backs one-tap save.',
    writers: ['routes/spotlists.js', 'routes/spots.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['name', 'description', 'userId', 'spotIds', 'createdAt'],
      properties: {
        _id: id,
        name: str,
        description: str,
        userId: str,
        spotIds: { bsonType: 'array', items: id },
        trickIds: { bsonType: 'array', items: id },
        isDefaultSaved: { bsonType: 'bool' },
        createdAt: date,
        updatedAt: date,
      },
    },
    notes: [
      'Insert sites: routes/spotlists.js POST / (name, description, userId, spotIds [], createdAt, updatedAt) and routes/spots.js POST /:id/save, an upsert whose $setOnInsert writes userId, isDefaultSaved true, name "Saved Spots", description "", spotIds [], createdAt (updatedAt arrives in the following $set). $set/$addToSet/$pull: routes/spotlists.js PUT /:id, POST and DELETE /:id/spots/*, POST and DELETE /:id/tricks/*; routes/spots.js POST and DELETE /:id/save, and DELETE /:id ($pull spotIds from every list).',
      'userId: both writers store req.user.userId, the JWT string, and every query matches the string. MONGODB_COLLECTIONS_SETUP.md documents it as ObjectId; that is the target, not what is stored.',
      'spotIds and trickIds hold ObjectIds (new ObjectId(...) at every $addToSet). trickIds reference the personal tricks collection, not trickipedia, and only routes/spotlists.js writes or reads them.',
      'isDefaultSaved: one hidden bucket per user, enforced by the partial unique index { userId: 1 } where isDefaultSaved: true, created at routes/spots.js router init. GET /api/spotlists and middleware/subscription.js checkSpotListLimit exclude it with isDefaultSaved: { $ne: true }; rows created before the flag simply lack the key and count as normal lists.',
      'Free-tier limits in middleware/subscription.js count documents per userId and spotIds.length per list; nothing caps trickIds. FREEMIUM_MODEL_SETUP.md mirrors those queries.',
      'Readers: routes/spots.js GET /saved and GET /:id/lists, middleware/subscription.js, routes/spotlists.js.',
    ],
  },

  spot_reviews: {
    description: 'One star rating plus text by one user on one spot; soft-deleted via status.',
    writers: ['routes/spotReviews.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'spotId',
        'userId',
        'rating',
        'content',
        'visitDate',
        'tags',
        'helpfulCount',
        'status',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: id,
        spotId: str,
        userId: str,
        rating: { bsonType: 'number', minimum: 1, maximum: 5 },
        content: str,
        visitDate: { bsonType: ['date', 'null'] },
        tags: strArray,
        helpfulCount: counter,
        status: { enum: ['active', 'deleted'] },
        createdAt: date,
        updatedAt: date,
        deletedAt: date,
        deletedBy: str,
      },
    },
    notes: [
      'Insert: routes/spotReviews.js POST / after createReviewSchema (Joi 14: rating 1-5, content up to 1000 chars, tags string[]). $set: PUT /:reviewId (rating, content, visitDate, tags, updatedAt; owner only) and DELETE /:reviewId (status "deleted", deletedAt, deletedBy; owner or admin). $inc helpfulCount by +1/-1 from POST /:reviewId/helpful.',
      'spotId is the spot _id as a string (req.body.spotId), unlike spot_trick_history.spotId which is an ObjectId. Every query matches the string and readers wrap it in new ObjectId() to join spots. userId and deletedBy are JWT strings; users are joined with new ObjectId(userId).',
      'One active review per (spotId, userId) is enforced by findOne-then-insert, not an index; a soft-deleted review does not block a new one.',
      'rating can be int or double (Joi.number). routes/spotReviews.js updateSpotRating recomputes spots.rating and spots.reviewCount from status "active" rows only.',
      'helpfulCount can drift from the review_helpful row count because the toggle is two unindexed writes with no transaction.',
      'Readers: GET /:spotId (pagination plus a $group rating distribution), GET /user/:userId.',
    ],
  },

  review_helpful: {
    description: 'One helpful mark by one user on one spot review; toggled by insert/delete.',
    writers: ['routes/spotReviews.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['reviewId', 'userId', 'createdAt'],
      properties: {
        _id: id,
        reviewId: str,
        userId: str,
        createdAt: date,
      },
    },
    notes: [
      'Insert and deleteOne both live in routes/spotReviews.js POST /:reviewId/helpful; the handler toggles on findOne({ reviewId, userId }). Both ids are strings (req.params.reviewId, req.user.userId).',
      'No unique index is created in code, and rows are not cleaned up when a review is soft-deleted.',
    ],
  },

  spot_trick_history: {
    description:
      'A notable trick landed at a spot (who, what, when, video), user submitted or curated, with upvotes.',
    writers: ['routes/spotTrickHistory.js'],
    jsonSchema: {
      bsonType: 'object',
      required: [
        'spotId',
        'trickName',
        'skaterName',
        'videoUrl',
        'thumbnailUrl',
        'source',
        'sourceUrl',
        'year',
        'description',
        'userId',
        'verified',
        'upvotes',
        'upvotedBy',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        _id: id,
        spotId: id,
        trickName: str,
        skaterName: str,
        videoUrl: strOrNull,
        thumbnailUrl: strOrNull,
        source: str,
        sourceUrl: strOrNull,
        year: { bsonType: ['number', 'null'] },
        description: strOrNull,
        userId: str,
        verified: { bsonType: 'bool' },
        upvotes: counter,
        upvotedBy: strArray,
        createdAt: date,
        updatedAt: date,
      },
    },
    notes: [
      'Insert: routes/spotTrickHistory.js POST / (auth) requires spotId, trickName, skaterName; spotId is cast with new ObjectId, verified is true only when the submitter is an admin, upvotes 0, upvotedBy []. $set: PUT /:id/verify (admin: verified true, updatedAt). $inc/$addToSet/$pull: POST /:id/upvote toggles upvotes and upvotedBy (JWT strings). DELETE /:id by owner or admin.',
      'spotId is an ObjectId here, the only spot-referencing collection that stores one (spot_reviews and spotlists-adjacent code use strings). userId is the JWT string, compared as a string for delete authorisation.',
      'source: defaults to "user_submitted"; the route accepts any string and the file header describes curated rows, so no enum. year is parseInt(body.year, 10) and becomes NaN (stored as a double, invalid to schemas/validate.js) when the client sends a non-numeric string; null when omitted.',
      'No index is created in code; GET /:spotId sorts by { year: -1, createdAt: -1 } or { upvotes: -1 }, and GET /skater/:skaterName does a case-insensitive regex on skaterName.',
      'Readers: routes/analytics.js (distinct userId by createdAt, latest activity), scripts/build-companion-graph.js and scripts/audit-companion-graph.js (all rows, to build rider/spot/trick edges).',
    ],
  },

  ck_spots: {
    description:
      'ConnectaKids crew spot (a separate side project) with lat/lng and a photos array; lives in the myFirstDatabase database.',
    writers: ['routes/connectakids.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['createdAt'],
      properties: {
        _id: id,
        name: str,
        city: str,
        state: str,
        lat: { bsonType: ['number', 'string'] },
        lng: { bsonType: ['number', 'string'] },
        description: str,
        category: str,
        photos: {
          bsonType: 'array',
          items: { bsonType: 'object', properties: { url: str, caption: str, addedAt: date } },
        },
        createdAt: date,
      },
    },
    notes: [
      'routes/connectakids.js is not mounted in index.js and opens getClient().db("myFirstDatabase") directly, so ck_* collections live in a different database from everything else; schemas/apply.js runs collMod against the app database and will list them as not present. No route in the file requires auth.',
      'Insert sites: GET /spots seeds DEFAULT_SPOTS with insertMany when the collection is empty ({ name, city, state, lat, lng, description, category, createdAt }); POST /spots inserts { ...req.body, createdAt } with no validation and geocodes lat/lng from city/state via open-meteo when lat is missing. Only createdAt is guaranteed.',
      'lat/lng: numbers from the seed list and the geocoder, otherwise whatever JSON type the client sent, so a "41.76" string is stored as a string. Typed number|string for that reason. The field names are lat/lng, not the latitude/longitude used by spots.',
      'photos: $push { url, caption, addedAt } from POST /spots/:id/photos (external url) and POST /spots/:id/upload (multer to public/ck-uploads, served as /ck-uploads/<file>); DELETE /spots/:id/photos/:index splices in memory and rewrites the whole array with $set.',
      'category: seeds use "home" and "expansion"; the POST body may send anything, so no enum.',
    ],
  },

  ck_trips: {
    description:
      'ConnectaKids planned trip with a crew roster; the rest of the document is whatever the client posted.',
    writers: ['routes/connectakids.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['createdByName', 'createdAt', 'crew'],
      properties: {
        _id: id,
        createdByName: str,
        createdAt: date,
        crew: { bsonType: 'array', items: { bsonType: 'object', properties: { name: str } } },
        date: str,
      },
    },
    notes: [
      'Same unmounted router and myFirstDatabase database as ck_spots.',
      'Insert: POST /trips spreads req.body, moves name into createdByName (trimmed), adds createdAt and crew [{ name }], then deletes name. Every other field is client-defined. GET /trips sorts by date, which no code writes explicitly; it is typed as the string a JSON body carries, matching the YYYY-MM-DD strings ck_availability uses.',
      'crew: $addToSet { name } from POST /trips/:id/join, so the same rider can join twice under different capitalisation. DELETE /trips/:id has no ownership check.',
    ],
  },

  ck_availability: {
    description: 'One ConnectaKids rider marked available on one calendar day; toggled by POST.',
    writers: ['routes/connectakids.js'],
    jsonSchema: {
      bsonType: 'object',
      required: ['date', 'name', 'nameLower', 'createdAt'],
      properties: {
        _id: id,
        date: str,
        name: str,
        nameLower: str,
        createdAt: date,
      },
    },
    notes: [
      'Same unmounted router and myFirstDatabase database as ck_spots.',
      'POST /availability toggles: an existing (date, nameLower) row is deleted, otherwise { date, name (trimmed), nameLower, createdAt } is inserted. No unique index.',
      'date is a client-supplied string, expected as YYYY-MM-DD: GET /availability?month=YYYY-MM builds an ISO-slice string range and compares lexically, so any other format falls outside every month filter. The format is not validated on write, so no pattern here.',
    ],
  },
};
