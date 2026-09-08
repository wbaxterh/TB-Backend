#!/usr/bin/env node
/**
 * Backfill rider profile photos from Wikipedia/Wikimedia Commons.
 *
 * For every editorial rider without a profileImage: look up the Wikipedia
 * article by canonical name, require the article summary to mention the
 * rider's sport (disambiguation guard), take the lead image, and verify on
 * Commons that its license is freely reusable (CC BY / CC BY-SA / CC0 /
 * public domain). Only then set profileImage with rights evidence.
 *
 * Dry-run by default; --apply writes. MONGODB_DATABASE selects the target.
 */

require('dotenv').config();
const { connectToDatabase, closeDatabase } = require('../db');

const FREE_LICENSES = /^(cc by(-sa)?( \d\.\d)?|cc0|public domain|pd)/i;
const UA = 'TrickBookBot/1.0 (https://thetrickbook.com; contact@thetrickbook.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

async function findPhoto(name, sport) {
  const title = encodeURIComponent(name.replace(/ /g, '_'));
  const summary = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);
  if (!summary || summary.type !== 'standard') return null;
  const text = `${summary.description || ''} ${summary.extract || ''}`.toLowerCase();
  const sportWord = sport === 'snowboarding' ? 'snowboard' : 'skateboard';
  if (!text.includes(sportWord)) return null;
  const original = summary.originalimage?.source;
  if (!original) return null;
  const fileMatch = decodeURIComponent(original).match(/\/([^/]+\.(?:jpe?g|png|webp))(?:$|\?)/i);
  if (!fileMatch) return null;
  const fileTitle = `File:${fileMatch[1]}`;
  const info = await getJson(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=extmetadata%7Curl&format=json`,
  );
  const page = info && Object.values(info.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const md = ii.extmetadata || {};
  const license = md.LicenseShortName?.value || '';
  if (!FREE_LICENSES.test(license)) return null;
  const artist = stripHtml(md.Artist?.value) || 'Wikimedia Commons contributor';
  return {
    url: ii.url.split('?')[0],
    alt: `${name} portrait`,
    rightsStatus: 'reuse_permitted',
    rightsEvidenceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`,
    credit: `${artist} via Wikimedia Commons (${license})`,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await connectToDatabase();
  const riders = db.collection('riders');
  const targets = await riders
    .find({ profileType: 'editorial', 'profileImage.url': { $exists: false } })
    .project({ canonicalName: 1, slug: 1, primarySport: 1 })
    .toArray();

  let found = 0;
  const matches = [];
  for (const rider of targets) {
    try {
      const photo = await findPhoto(rider.canonicalName, rider.primarySport);
      if (photo) {
        matches.push({ slug: rider.slug, credit: photo.credit });
        found++;
        if (apply) {
          await riders.updateOne(
            { _id: rider._id },
            { $set: { profileImage: photo, updatedAt: new Date() } },
          );
        }
        console.error(`photo: ${rider.slug} <- ${photo.url.slice(0, 80)}`);
      }
    } catch (err) {
      console.error(`skip ${rider.slug}: ${String(err).slice(0, 80)}`);
    }
    await sleep(120);
  }
  console.log(
    JSON.stringify({
      database: db.databaseName,
      candidates: targets.length,
      found,
      applied: apply,
    }),
  );
  await closeDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
