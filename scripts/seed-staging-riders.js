require('dotenv').config();
const { MongoClient } = require('mongodb');

const PUBLIC_FIELDS = {
  _id: 1,
  name: 1,
  imageUri: 1,
  sports: 1,
  bio: 1,
  riderProfile: 1,
  network: 1,
  isBot: 1,
  createdAt: 1,
};

async function main() {
  if (process.env.MONGODB_DATABASE !== 'TrickList2Staging') {
    throw new Error('Refusing to seed a non-staging target');
  }

  const client = new MongoClient(process.env.ATLAS_URI);
  await client.connect();
  try {
    const source = client.db('TrickList2').collection('users');
    const target = client.db('TrickList2Staging').collection('users');
    const riders = await source
      .find({ network: true, isBot: { $ne: true } })
      .project(PUBLIC_FIELDS)
      .toArray();

    if (riders.length) {
      await target.bulkWrite(
        riders.map((rider) => ({
          replaceOne: {
            filter: { _id: rider._id },
            replacement: { ...rider, stagingFixture: true },
            upsert: true,
          },
        })),
      );
    }

    await target.deleteMany({ stagingFixture: true, _id: { $nin: riders.map((rider) => rider._id) } });
    console.log(`Seeded ${riders.length} sanitized public rider profiles`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
