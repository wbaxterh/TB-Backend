#!/usr/bin/env node
// Push the registered schemas to the database as collection validators, outside of
// a server boot. Use it to promote a collection to `error` once schema-report.js
// shows it clean, or to switch validators off.
//
//   node scripts/schema-apply.js [--action warn|error|off] [--level moderate|strict]
require('dotenv').config();

const { connectToDatabase, closeDatabase } = require('../db');
const { applyCollectionSchemas, describeSummary } = require('../schemas/apply');

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--action') args.action = argv[i + 1];
    if (argv[i] === '--level') args.level = argv[i + 1];
  }
  return args;
}

async function main() {
  const db = await connectToDatabase();
  try {
    const summary = await applyCollectionSchemas(db, readArgs(process.argv.slice(2)));
    console.log(describeSummary(summary));
    for (const failure of summary.failed) console.log(`  ${failure.name}: ${failure.error}`);
    if (summary.missing.length) console.log(`  not present: ${summary.missing.join(', ')}`);
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
