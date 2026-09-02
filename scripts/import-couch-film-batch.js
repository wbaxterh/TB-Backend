#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectToDatabase, closeDatabase } = require('../db');

const input = process.argv.find(
  (value) => !value.startsWith('--') && value !== process.argv[0] && value !== process.argv[1],
);
const apply = process.argv.includes('--apply');

function validate(film) {
  const errors = [];
  if (!film.slug) errors.push('slug');
  if (!film.title) errors.push('title');
  if (film.type !== 'film') errors.push('type=film');
  if (!film.sportTypes?.length) errors.push('sportTypes');
  if (!film.producedBy) errors.push('producedBy');
  if (!film.sourceRecords?.length) errors.push('sourceRecords');
  if (!film.rights?.hostingStatus) errors.push('rights.hostingStatus');
  if (film.isPublished && film.availabilityStatus !== 'available') {
    errors.push('published film must be available');
  }
  if (film.isPublished && !film.watchOptions?.some((option) => option.isOfficialPublisher)) {
    errors.push('published film must have an official watch option');
  }
  return errors;
}

async function main() {
  if (!input) {
    throw new Error('Usage: node scripts/import-couch-film-batch.js <batch.json> [--apply]');
  }

  const payload = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  const films = payload.films || [];
  const invalid = films
    .map((film) => ({ title: film.title, errors: validate(film) }))
    .filter((item) => item.errors.length);
  if (invalid.length) throw new Error(`Invalid records: ${JSON.stringify(invalid)}`);

  console.log(`${apply ? 'Applying' : 'Dry run for'} ${films.length} films from ${input}`);
  console.table(
    films.map((film) => ({
      title: film.title,
      sport: film.sportTypes.join(', '),
      year: film.releaseYear,
      producer: film.producedBy,
      riders: film.riders.length,
      published: film.isPublished,
      status: film.researchStatus,
    })),
  );
  if (!apply) return;

  const db = await connectToDatabase();
  const collection = db.collection('couch_videos');
  await collection.createIndex(
    { slug: 1 },
    { unique: true, sparse: true, name: 'film_slug_unique' },
  );

  let inserted = 0;
  let updated = 0;
  for (const film of films) {
    const now = new Date();
    const result = await collection.updateOne(
      { slug: film.slug },
      {
        $set: { ...film, updatedAt: now },
        $setOnInsert: { createdAt: now, viewCount: 0, isFeatured: false, order: 0 },
      },
      { upsert: true },
    );
    inserted += result.upsertedCount;
    updated += result.matchedCount;
  }

  console.log(JSON.stringify({ inserted, updated, total: films.length }));
  await closeDatabase();
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
