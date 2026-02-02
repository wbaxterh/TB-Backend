require('dotenv').config();
const mongoose = require('mongoose');

if (!process.env.ATLAS_URI) {
  console.error('ERROR: ATLAS_URI environment variable is not set. Run with: node -r dotenv/config delete_users.js');
  process.exit(1);
}
const ATLAS_URI = process.env.ATLAS_URI;

const emailsToDelete = [
  'westest69@mail.com',
  'westest6987@mail.com',
  'testshred@mail.com'
];

async function deleteUsers() {
  try {
    await mongoose.connect(ATLAS_URI);
    console.log('Connected to MongoDB');

    const User = mongoose.connection.collection('users');
    
    for (const email of emailsToDelete) {
      const result = await User.deleteOne({ email: email });
      if (result.deletedCount > 0) {
        console.log(`✓ Deleted user: ${email}`);
      } else {
        console.log(`✗ User not found: ${email}`);
      }
    }
    
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

deleteUsers();
