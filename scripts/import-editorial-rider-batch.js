#!/usr/bin/env node

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { closeDatabase, connectToDatabase, getClient } = require('../db');
const { importEditorialRiderBatch } = require('../services/riders/editorialRiderImporter');

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function main() {
  const input = argumentValue('--input');
  const canaryFile = argumentValue('--canary-evidence');
  const dryRunFile = argumentValue('--dry-run-evidence');
  const apply = process.argv.includes('--apply');
  const production = process.argv.includes('--production');
  if (!input) {
    throw new Error(
      'Usage: node scripts/import-editorial-rider-batch.js --input=<batch.json> [--apply --dry-run-evidence=<result.json>] [--production --canary-evidence=<evidence.json>]',
    );
  }
  const databaseName = process.env.MONGODB_DATABASE || 'TrickList2Staging';
  process.env.MONGODB_DATABASE = databaseName;
  const payload = readJson(input);
  const canary = canaryFile ? readJson(canaryFile) : undefined;
  const dryRunEvidence = dryRunFile ? readJson(dryRunFile) : undefined;
  const db = await connectToDatabase();
  const result = await importEditorialRiderBatch({
    db,
    client: getClient(),
    payload,
    databaseName,
    apply,
    production,
    canary,
    dryRunEvidence,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase().catch(() => {}));
