#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config();
const { MongoClient } = require('mongodb');
const { normalizeShop } = require('../services/shops/normalizeShop');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const file = argument('--file');
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('Usage: npm run shops:import -- --file shops.json [--apply]');

  const absolutePath = path.resolve(process.cwd(), file);
  const input = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  if (!Array.isArray(input) || input.length === 0)
    throw new Error('Import file must be a non-empty array');
  if (input.length > 500) throw new Error('A single import is limited to 500 shops');

  const normalized = input.map((shop, index) => {
    try {
      return normalizeShop(shop);
    } catch (error) {
      throw new Error(`Shop ${index + 1}: ${error.message}`);
    }
  });
  const slugs = normalized.map((shop) => shop.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('Import contains duplicate slugs');

  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, count: normalized.length, slugs }, null, 2));
    return;
  }
  if (!process.env.ATLAS_URI) throw new Error('ATLAS_URI is required for --apply');

  const client = new MongoClient(process.env.ATLAS_URI);
  await client.connect();
  try {
    const databaseName = process.env.SHOPS_IMPORT_DB || 'TrickList2';
    const collection = client.db(databaseName).collection('shops');
    const result = await collection.bulkWrite(
      normalized.map((shop) => ({
        updateOne: {
          filter: { slug: shop.slug },
          update: {
            $set: shop,
            $setOnInsert: { createdAt: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    console.log(
      JSON.stringify(
        {
          dryRun: false,
          database: databaseName,
          count: normalized.length,
          matched: result.matchedCount,
          modified: result.modifiedCount,
          upserted: result.upsertedCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
