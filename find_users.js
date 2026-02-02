const mongoose = require('mongoose');

const ATLAS_URI = "mongodb+srv://wes:majorasmask@cluster0.v1sxt.gcp.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";

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
        { email: { $regex: /testshred/i } }
      ]
    }).toArray();
    
    console.log(`Found ${testUsers.length} test users:\n`);
    testUsers.forEach(u => {
      console.log(`Name: ${u.name}`);
      console.log(`Email: ${u.email}`);
      console.log(`ID: ${u._id}`);
      console.log('---');
    });
    
    // Also list all users in DB to see what's there
    console.log('\n--- All users in DB ---');
    const allUsers = await User.find({}).project({ name: 1, email: 1 }).limit(20).toArray();
    allUsers.forEach(u => console.log(`${u.name} - ${u.email}`));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

findUsers();
