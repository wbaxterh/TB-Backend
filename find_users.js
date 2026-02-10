require('dotenv').config();
const mongoose = require('mongoose');

if (!process.env.ATLAS_URI) {
  console.error(
    'ERROR: ATLAS_URI environment variable is not set. Run with: node -r dotenv/config find_users.js',
  );
  process.exit(1);
}
const ATLAS_URI = process.env.ATLAS_URI;

async function findUsers() {
  try {
    await mongoose.connect(ATLAS_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.connection.collection('users');

    // Search for users by name patterns from screenshot
    const testUsers = await User.find({
      $or: [
        { name: { $regex: /westest/i } },
        { name: { $regex: /wEstes/i } },
        { name: { $regex: /testerguy/i } },
        { email: { $regex: /westest/i } },
        { email: { $regex: /testshred/i } },
      ],
    }).toArray();

    console.log(`Found ${testUsers.length} test users:\n`);
    testUsers.forEach((u) => {
      console.log(`Name: ${u.name}`);
      console.log(`Email: ${u.email}`);
      console.log(`ID: ${u._id}`);
      console.log('---');
    });

    // Also list all users in DB to see what's there
    console.log('\n--- All users in DB ---');
    const allUsers = await User.find({}).project({ name: 1, email: 1 }).limit(20).toArray();
    for (const u of allUsers) {
      console.log(`${u.name} - ${u.email}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

findUsers();
