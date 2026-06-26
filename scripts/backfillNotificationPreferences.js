/**
 * One-time migration: ensure every existing user has a notificationPreferences subdoc.
 * Idempotent — safe to re-run. Skips users that already have prefs.
 *
 * Usage:
 *   node scripts/backfillNotificationPreferences.js
 *
 * Spec: docs/docs/features/notifications.md §4.1
 */

require('dotenv').config();

const { connectToDatabase, closeDatabase } = require('../db');
const { buildDefaultNotificationPreferences } = require('../services/notificationDefaults');

async function main() {
  const db = await connectToDatabase();
  const users = db.collection('users');

  const filter = { notificationPreferences: { $exists: false } };
  const remaining = await users.countDocuments(filter);
  if (remaining === 0) {
    console.log('No users needed backfilling. Done.');
    return;
  }
  console.log(`Backfilling notificationPreferences for ${remaining} users…`);

  const result = await users.updateMany(filter, {
    $set: { notificationPreferences: buildDefaultNotificationPreferences() },
  });
  console.log(`Updated ${result.modifiedCount} users.`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase().then(() => process.exit(process.exitCode || 0)));
