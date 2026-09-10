#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');
const { search } = require('../kaori-rag/kaori-query');

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) throw new Error('Usage: npm run rag:query -- "your semantic query"');
  if (!process.env.ATLAS_URI) throw new Error('ATLAS_URI environment variable is not set');
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    const results = await search(db, query, 5);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('[Kaori RAG] query failed:', error);
    process.exit(1);
  },
);
