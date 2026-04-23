const express = require('express');
const router = express.Router();
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload dir exists
const uploadDir = path.join(__dirname, '..', 'public', 'ck-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const ATLAS_URI = process.env.ATLAS_URI;
let db;

async function getDb() {
  if (db) return db;
  const client = await MongoClient.connect(ATLAS_URI);
  db = client.db('myFirstDatabase');
  return db;
}

const DEFAULT_SPOTS = [
  {
    name: 'Old State House Steps',
    city: 'Hartford',
    state: 'CT',
    lat: 41.7637,
    lng: -72.6735,
    description: 'Classic marble steps, multiple ledge options',
    category: 'home',
  },
  {
    name: 'Bushnell Park Rails',
    city: 'Hartford',
    state: 'CT',
    lat: 41.7627,
    lng: -72.6823,
    description: 'Park rails near the carousel, mellow vibes',
    category: 'home',
  },
  {
    name: 'Yale Gothic Arches',
    city: 'New Haven',
    state: 'CT',
    lat: 41.3111,
    lng: -72.9267,
    description: 'Stone arches with perfect wallride angles',
    category: 'home',
  },
  {
    name: 'Sterling Library Benches',
    city: 'New Haven',
    state: 'CT',
    lat: 41.3116,
    lng: -72.9289,
    description: 'Granite benches, smooth ground',
    category: 'home',
  },
  {
    name: 'Frozen Seaport Docks',
    city: 'Mystic',
    state: 'CT',
    lat: 41.3615,
    lng: -71.9662,
    description: 'Wooden dock edges, waterfront backdrop',
    category: 'home',
  },
  {
    name: 'Old Crane Arms',
    city: 'Mystic',
    state: 'CT',
    lat: 41.3601,
    lng: -71.9658,
    description: 'Industrial crane structures, unique features',
    category: 'home',
  },
  {
    name: 'Windham Textile Mill',
    city: 'Windham',
    state: 'CT',
    lat: 41.7098,
    lng: -72.1573,
    description: 'Brick ruins, loading ramps, raw industrial',
    category: 'home',
  },
  {
    name: 'Brass Factory Row',
    city: 'Bridgeport',
    state: 'CT',
    lat: 41.1792,
    lng: -73.1894,
    description: 'Loading bays, brick ledges, gritty aesthetic',
    category: 'home',
  },
  {
    name: 'Oyster Dock Pilings',
    city: 'Norwalk',
    state: 'CT',
    lat: 41.0968,
    lng: -73.4154,
    description: 'Dock pilings and flat ground by the water',
    category: 'home',
  },
  {
    name: 'Boston (Weekend Trip)',
    city: 'Boston',
    state: 'MA',
    lat: 42.3601,
    lng: -71.0589,
    description: 'Weekend AirBnb trip — multiple spots TBD',
    category: 'expansion',
  },
  {
    name: 'Worcester (Weekend Trip)',
    city: 'Worcester',
    state: 'MA',
    lat: 42.2626,
    lng: -71.8023,
    description: 'Weekend AirBnb trip — industrial city, tons of street spots',
    category: 'expansion',
  },
  {
    name: 'Portland ME (Weekend Trip)',
    city: 'Portland',
    state: 'ME',
    lat: 43.6591,
    lng: -70.2568,
    description: 'Weekend AirBnb trip — waterfront + Old Port',
    category: 'expansion',
  },
  {
    name: 'Burlington VT (Weekend Trip)',
    city: 'Burlington',
    state: 'VT',
    lat: 44.4759,
    lng: -73.2121,
    description: 'Weekend AirBnb trip — Church St + waterfront',
    category: 'expansion',
  },
];

// === SPOTS ===
router.get('/spots', async (_req, res) => {
  try {
    const db = await getDb();
    const spots = await db.collection('ck_spots').find({}).toArray();
    if (spots.length === 0) {
      await db
        .collection('ck_spots')
        .insertMany(DEFAULT_SPOTS.map((s) => ({ ...s, createdAt: new Date() })));
      const seeded = await db.collection('ck_spots').find({}).toArray();
      return res.json(seeded);
    }
    res.json(spots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/spots', async (req, res) => {
  try {
    const db = await getDb();
    const spot = { ...req.body, createdAt: new Date() };
    // Auto-geocode if no lat/lng
    if (!spot.lat && spot.city) {
      try {
        const axios = require('axios');
        const q = encodeURIComponent(`${spot.city + (spot.state ? `, ${spot.state}` : '')}, US`);
        const geo = await axios.get(
          `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`,
        );
        if (geo.data.results && geo.data.results.length > 0) {
          spot.lat = geo.data.results[0].latitude;
          spot.lng = geo.data.results[0].longitude;
        }
      } catch (_e) {
        /* geocode failed, skip */
      }
    }
    const result = await db.collection('ck_spots').insertOne(spot);
    res.json({ ...spot, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SPOT PHOTOS ===
router.post('/spots/:id/photos', async (req, res) => {
  try {
    const db = await getDb();
    const { url, caption } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const photo = { url, caption: caption || '', addedAt: new Date() };
    await db
      .collection('ck_spots')
      .updateOne({ _id: new ObjectId(req.params.id) }, { $push: { photos: photo } });
    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload photo from device
router.post('/spots/:id/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    const db = await getDb();
    const url = `/ck-uploads/${req.file.filename}`;
    const photo = { url, caption: '', addedAt: new Date() };
    await db
      .collection('ck_spots')
      .updateOne({ _id: new ObjectId(req.params.id) }, { $push: { photos: photo } });
    res.json(photo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a photo from a spot by index
router.delete('/spots/:id/photos/:index', async (req, res) => {
  try {
    const db = await getDb();
    const spot = await db.collection('ck_spots').findOne({ _id: new ObjectId(req.params.id) });
    if (!spot) return res.status(404).json({ error: 'spot not found' });
    const photos = spot.photos || [];
    const idx = parseInt(req.params.index, 10);
    if (idx < 0 || idx >= photos.length) return res.status(400).json({ error: 'invalid index' });
    photos.splice(idx, 1);
    await db
      .collection('ck_spots')
      .updateOne({ _id: new ObjectId(req.params.id) }, { $set: { photos } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a spot
router.delete('/spots/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('ck_spots').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AVAILABILITY ===
router.get('/availability', async (req, res) => {
  try {
    const db = await getDb();
    const filter = {};
    if (req.query.month) {
      const start = new Date(`${req.query.month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      filter.date = { $gte: start.toISOString().slice(0, 10), $lt: end.toISOString().slice(0, 10) };
    }
    const avail = await db.collection('ck_availability').find(filter).toArray();
    res.json(avail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/availability', async (req, res) => {
  try {
    const db = await getDb();
    const { date, name } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date required' });
    const nameLower = name.trim().toLowerCase();
    const existing = await db.collection('ck_availability').findOne({ date, nameLower });
    if (existing) {
      await db.collection('ck_availability').deleteOne({ _id: existing._id });
      return res.json({ removed: true, date });
    }
    const entry = { date, name: name.trim(), nameLower, createdAt: new Date() };
    await db.collection('ck_availability').insertOne(entry);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === TRIPS ===
router.get('/trips', async (_req, res) => {
  try {
    const db = await getDb();
    const trips = await db.collection('ck_trips').find({}).sort({ date: 1 }).toArray();
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trips', async (req, res) => {
  try {
    const db = await getDb();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const trip = {
      ...req.body,
      createdByName: name.trim(),
      createdAt: new Date(),
      crew: [{ name: name.trim() }],
    };
    delete trip.name;
    const result = await db.collection('ck_trips').insertOne(trip);
    res.json({ ...trip, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trips/:id/join', async (req, res) => {
  try {
    const db = await getDb();
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    await db
      .collection('ck_trips')
      .updateOne(
        { _id: new ObjectId(req.params.id) },
        { $addToSet: { crew: { name: name.trim() } } },
      );
    res.json({ joined: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/trips/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.collection('ck_trips').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === WEATHER ===
router.get('/weather', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
    const axios = require('axios');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=7`;
    const resp = await axios.get(url);
    res.json(resp.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
