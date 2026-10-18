#!/usr/bin/env node

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { closeDatabase, connectToDatabase, getClient } = require('../db');
const { enrichEditorialRiderBatch } = require('../services/riders/editorialRiderEnricher');

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function printUsage() {
  console.log(`
Usage: node scripts/enrich-editorial-riders.js --input=<batch.json> [options]

Options:
  --input=<file>              Required. Path to the enrichment batch JSON file.
  --apply                     Apply the changes (default is dry-run mode).
  --dry-run-evidence=<file>   Required with --apply. Path to the dry-run result JSON.
  --production                Target production database (requires canary evidence).
  --canary-evidence=<file>    Required with --production. Path to the canary evidence JSON.

Workflow:
  1. DRY RUN (staging): Generate a diff and fingerprint
     npm run riders:enrich -- --input=batch.json > dry-run-result.json

  2. APPLY (staging): Apply changes using the dry-run proof
     npm run riders:enrich -- --input=batch.json --apply --dry-run-evidence=dry-run-result.json

  3. VERIFY: Confirm changes via API and record canary evidence

  4. DRY RUN (production): Generate production diff
     npm run riders:enrich -- --input=batch.json --production --canary-evidence=canary.json > prod-dry-run.json

  5. APPLY (production): Apply to production
     npm run riders:enrich -- --input=batch.json --apply --production --canary-evidence=canary.json --dry-run-evidence=prod-dry-run.json

Batch JSON format:
  {
    "batchId": "unique-batch-identifier",
    "riders": [
      {
        "slug": "tony-hawk-skateboarding",
        "competitiveStatus": "pro",
        "contestHistory": [...],
        "sponsors": ["Birdhouse", "Vans"],
        "overrides": { "competitiveStatus": true }  // optional: force overwrite
      }
    ]
  }

Enrichment rules:
  - Scalar fields (nationality, homeRegion, etc.) are filled only when empty
  - Array fields (sponsors, contestHistory, etc.) are appended with deduplication
  - Protected fields (biography, canonicalName, primarySport, slug) require explicit override
  - Batch size limit: 15 riders per batch
`);
}

async function main() {
  const input = argumentValue('--input');
  const canaryFile = argumentValue('--canary-evidence');
  const dryRunFile = argumentValue('--dry-run-evidence');
  const apply = process.argv.includes('--apply');
  const production = process.argv.includes('--production');
  const help = process.argv.includes('--help') || process.argv.includes('-h');

  if (help) {
    printUsage();
    return;
  }

  if (!input) {
    printUsage();
    throw new Error('--input is required');
  }

  const databaseName = production
    ? process.env.MONGODB_DATABASE_PRODUCTION || 'TrickList2'
    : process.env.MONGODB_DATABASE || 'TrickList2Staging';

  process.env.MONGODB_DATABASE = databaseName;

  const payload = readJson(input);
  const canary = canaryFile ? readJson(canaryFile) : undefined;
  const dryRunEvidence = dryRunFile ? readJson(dryRunFile) : undefined;

  const db = await connectToDatabase();
  const result = await enrichEditorialRiderBatch({
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
