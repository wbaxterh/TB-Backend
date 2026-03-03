/**
 * Seed script for spots
 * Run with: node scripts/seedSpots.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const connectionString = process.env.ATLAS_URI;

const spots = [
  // ==================
  // SKATE SPOTS (3)
  // ==================
  {
    name: 'LES Coleman Skatepark',
    latitude: 40.7142,
    longitude: -73.9903,
    imageURL: 'https://images.unsplash.com/photo-1564429238133-068dfeaa9352?w=800',
    description:
      'One of the most famous skateparks in NYC, located under the Manhattan Bridge. Features smooth ledges, rails, banks, and transitions. After its 2012 redesign, P-Rod called it one of the best skate parks in the world. A favorite for both locals and pros filming parts.',
    rating: 4.8,
    tags: 'ledges, rails, banks, transitions, street plaza, concrete',
    city: 'New York',
    state: 'NY',
    isPublic: true,
    sportTypes: ['skateboarding', 'scooter', 'rollerblading'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },
  {
    name: 'Pier 62 Skate Park',
    latitude: 40.7461,
    longitude: -74.0071,
    imageURL: 'https://images.unsplash.com/photo-1572776685609-4e7e8a0ef709?w=800',
    description:
      'A massive 15,000 square foot skatepark at the end of a pier overlooking the Hudson River. Skaters who love ramps and halfpipes flock here. The scenic waterfront location makes it one of the most unique skate spots in the city.',
    rating: 4.6,
    tags: 'ramps, halfpipes, waterfront, scenic, transitions',
    city: 'New York',
    state: 'NY',
    isPublic: true,
    sportTypes: ['skateboarding', 'scooter', 'rollerblading', 'bmx'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },
  {
    name: 'Astoria Skatepark',
    latitude: 40.7794,
    longitude: -73.9235,
    imageURL: 'https://images.unsplash.com/photo-1579555472991-f0418827f855?w=800',
    description:
      'A true street plaza masterpiece and one of the best skate parks in New York. Located underneath the Robert F Kennedy Bridge inside Astoria Park. Features a great variety of obstacles including ledges, manual pads, stairs, and rails.',
    rating: 4.7,
    tags: 'street plaza, ledges, manual pads, stairs, rails, concrete',
    city: 'Queens',
    state: 'NY',
    isPublic: true,
    sportTypes: ['skateboarding', 'scooter', 'rollerblading'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },

  // ==================
  // SKI/SNOWBOARD SPOTS (3) - All with terrain parks
  // ==================
  {
    name: 'Hunter Mountain',
    latitude: 42.2037,
    longitude: -74.2257,
    imageURL: 'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=800',
    description:
      'One of the premier ski resorts in the Catskills, just under 3 hours from NYC. Boasts terrain across three separate mountains with 66 trails and 320 acres of skiable terrain. Features multiple terrain parks with jumps, rails, and boxes for all skill levels.',
    rating: 4.5,
    tags: 'terrain park, jumps, rails, boxes, halfpipe, night skiing, lessons',
    city: 'Hunter',
    state: 'NY',
    isPublic: true,
    sportTypes: ['snowboarding', 'skiing'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },
  {
    name: 'Thunder Ridge Ski Area',
    latitude: 41.4897,
    longitude: -73.5851,
    imageURL: 'https://images.unsplash.com/photo-1605540436563-5bca919ae766?w=800',
    description:
      'Located just 60 minutes north of NYC in Patterson, NY. Features 22 trails with a 500ft vertical drop and 100% snowmaking. Has a dedicated terrain park with rails and jumps, plus a halfpipe. Take the Metro-North Ski Train with free shuttle from Patterson station.',
    rating: 4.2,
    tags: 'terrain park, halfpipe, rails, jumps, night skiing, metro accessible, beginner friendly',
    city: 'Patterson',
    state: 'NY',
    isPublic: true,
    sportTypes: ['snowboarding', 'skiing'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },
  {
    name: 'Powder Ridge Mountain Park',
    latitude: 41.5157,
    longitude: -72.7104,
    imageURL: 'https://images.unsplash.com/photo-1517483000871-1dbf64a6e1c6?w=800',
    description:
      "A park-focused mountain in Middlefield, CT with FOUR terrain parks for freestyle enthusiasts. Features 19 trails on 80 acres with jumps, rails, boxes, and an airbag for learning new tricks safely. Home to CT's only Terrain Based Learning facility. Very snowboard/park oriented.",
    rating: 4.3,
    tags: 'terrain park, four parks, airbag, jumps, rails, boxes, freestyle, tubing',
    city: 'Middlefield',
    state: 'CT',
    isPublic: true,
    sportTypes: ['snowboarding', 'skiing'],
    category: 'park',
    approvalStatus: 'approved',
    createdAt: new Date(),
  },
];

async function seedSpots() {
  let client;

  try {
    console.log('Connecting to MongoDB...');
    client = await MongoClient.connect(connectionString, {
      useUnifiedTopology: true,
    });

    const db = client.db('TrickList2');
    const spotsCollection = db.collection('spots');

    console.log('Seeding spots...\n');

    for (const spot of spots) {
      // Check if spot already exists by coordinates
      const existing = await spotsCollection.findOne({
        latitude: spot.latitude,
        longitude: spot.longitude,
      });

      if (existing) {
        console.log(`  [SKIP] "${spot.name}" already exists`);
      } else {
        await spotsCollection.insertOne(spot);
        console.log(`  [ADD]  "${spot.name}" - ${spot.city}, ${spot.state}`);
      }
    }

    console.log('\nSeeding complete!');

    // Show count
    const count = await spotsCollection.countDocuments({ approvalStatus: 'approved' });
    console.log(`Total approved spots in database: ${count}`);
  } catch (error) {
    console.error('Error seeding spots:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

seedSpots();
