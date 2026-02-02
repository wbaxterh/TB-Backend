const mongoose = require('mongoose');

const ATLAS_URI = "mongodb+srv://wes:majorasmask@cluster0.v1sxt.gcp.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";

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
