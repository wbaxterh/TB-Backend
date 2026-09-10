#!/usr/bin/env node
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { evaluateCase, summarize } = require('../kaori-rag/evaluate');
const { search } = require('../kaori-rag/kaori-query');

async function main() {
  const uri = process.env.ATLAS_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('ATLAS_URI or MONGO_URI is required');
  const databaseName = process.env.MONGO_DB || 'TrickList2';
  const file = process.argv[2] || path.join(__dirname, '..', 'kaori-rag', 'golden-queries.json');
  const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(databaseName);
    const results = [];
    for (const testCase of cases) {
      const started = Date.now();
      let hits = [];
      let error;
      try {
        hits = await search(db, testCase.query, 5);
      } catch (caught) {
        error = caught.message;
      }
      results.push({ ...evaluateCase(testCase, hits, Date.now() - started), error });
    }
    const report = { generatedAt: new Date().toISOString(), summary: summarize(results), results };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.summary.recallAt5 < Number(process.env.KAORI_RAG_MIN_RECALL || 0.6)) {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
