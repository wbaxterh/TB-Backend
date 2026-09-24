#!/usr/bin/env node
// Validate recent documents from every registered collection against its schema,
// app-side. This is the feedback loop for schema drift on tiers where mongod's
// "warn" log is not readable (Atlas M0).
//
//   node scripts/schema-report.js [--sample 200] [--collection users] [--verbose]
require('dotenv').config();

const { connectToDatabase, closeDatabase } = require('../db');
const { registry, names, validate } = require('../schemas');

function readArgs(argv) {
  const args = { sample: 200, collection: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sample') args.sample = Number(argv[i + 1]) || args.sample;
    if (argv[i] === '--collection') args.collection = argv[i + 1];
    if (argv[i] === '--verbose') args.verbose = true;
  }
  return args;
}

async function reportCollection(db, name, sample, verbose) {
  const docs = await db.collection(name).find({}).sort({ _id: -1 }).limit(sample).toArray();
  const byPath = new Map();
  let invalid = 0;
  for (const doc of docs) {
    const result = validate(name, doc);
    if (result.valid) continue;
    invalid += 1;
    for (const error of result.errors) {
      const key = `${error.path}: ${error.message}`;
      byPath.set(key, (byPath.get(key) || 0) + 1);
    }
  }
  const worst = [...byPath.entries()].sort((a, b) => b[1] - a[1]);
  const headline = `${name.padEnd(28)} sampled ${String(docs.length).padStart(4)}  invalid ${String(invalid).padStart(4)}`;
  console.log(headline);
  const shown = verbose ? worst : worst.slice(0, 5);
  for (const [key, count] of shown) console.log(`    ${String(count).padStart(4)}  ${key}`);
  return { name, sampled: docs.length, invalid };
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const db = await connectToDatabase();
  try {
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
    );
    const targets = (args.collection ? [args.collection] : names).filter((name) => {
      if (!registry[name]) {
        console.error(`no schema registered for "${name}"`);
        return false;
      }
      return existing.has(name);
    });
    const totals = { sampled: 0, invalid: 0 };
    for (const name of targets) {
      const result = await reportCollection(db, name, args.sample, args.verbose);
      totals.sampled += result.sampled;
      totals.invalid += result.invalid;
    }
    const unregistered = [...existing].filter(
      (name) => !registry[name] && !name.startsWith('system.'),
    );
    console.log(`\nsampled ${totals.sampled} documents, ${totals.invalid} invalid`);
    if (unregistered.length)
      console.log(`collections without a schema: ${unregistered.join(', ')}`);
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
