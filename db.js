const { MongoClient } = require('mongodb');

let client;
let db;

async function connectToDatabase() {
  const connectionString = process.env.ATLAS_URI;
  if (!connectionString) {
    throw new Error('ATLAS_URI environment variable is not set');
  }

  client = new MongoClient(connectionString, {
    maxPoolSize: 20,
    minPoolSize: 5,
    maxIdleTimeMS: 60000,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true,
  });

  await client.connect();
  db = client.db('TrickList2');
  console.log('Connected to MongoDB Atlas (shared connection pool, maxPoolSize: 20)');
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

function getClient() {
  return client;
}

async function closeDatabase() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = { connectToDatabase, getDb, getClient, closeDatabase };
