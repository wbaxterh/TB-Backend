const fs = require('fs');
const zlib = require('zlib');
const jwt = require('jsonwebtoken');

// Real download numbers from the store back-ends.
//
// iOS  — App Store Connect Sales Reports API. Needs an API key with the
//        "Sales and Reports" role:
//          ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH (.p8), ASC_VENDOR_NUMBER
// Play — Play Console stats export in Cloud Storage. Needs the report bucket id
//        (Play Console → Download reports → Copy Cloud Storage URI) and a service
//        account with report access:
//          PLAY_STATS_BUCKET (pubsite_prod_rev_…), GOOGLE_PLAY_SA_KEY_PATH
//
// Store responses are cached in-memory — Apple only produces one report per day,
// so hitting them on every dashboard load is pointless.

const PACKAGE_NAME = 'com.thetrickbook.trickbook';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Product type identifiers that count as an app download (7* = redownloads/updates)
const APPLE_DOWNLOAD_TYPES = new Set(['1', '1F', '1T', '1E', '1EP', '1EU']);

const cache = new Map();

function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = fn();
  cache.set(key, { value, expires: Date.now() + ttl });
  value.catch(() => cache.delete(key));
  return value;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// ---------- Apple ----------

function ascToken() {
  const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH } = process.env;
  const privateKey = fs.readFileSync(ASC_PRIVATE_KEY_PATH, 'utf8');
  return jwt.sign({ iss: ASC_ISSUER_ID, aud: 'appstoreconnect-v1' }, privateKey, {
    algorithm: 'ES256',
    expiresIn: '15m',
    header: { kid: ASC_KEY_ID },
  });
}

async function fetchAppleDay(token, reportDate) {
  const params = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportDate]': reportDate,
    'filter[reportSubType]': 'SUMMARY',
    'filter[reportType]': 'SALES',
    'filter[vendorNumber]': process.env.ASC_VENDOR_NUMBER,
  });
  const resp = await fetch(`https://api.appstoreconnect.apple.com/v1/salesReports?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
  });
  // Apple 404s dates with no report yet (today/very recent) — treat as zero
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`ASC salesReports ${resp.status}`);

  const tsv = zlib.gunzipSync(Buffer.from(await resp.arrayBuffer())).toString('utf8');
  const [headerLine, ...rows] = tsv.split('\n').filter(Boolean);
  const headers = headerLine.split('\t');
  const unitsIdx = headers.indexOf('Units');
  const typeIdx = headers.indexOf('Product Type Identifier');

  let downloads = 0;
  for (const row of rows) {
    const cols = row.split('\t');
    if (APPLE_DOWNLOAD_TYPES.has(cols[typeIdx])) downloads += Number(cols[unitsIdx]) || 0;
  }
  return downloads;
}

async function getIosDownloads(days) {
  const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH, ASC_VENDOR_NUMBER } = process.env;
  if (!ASC_ISSUER_ID || !ASC_KEY_ID || !ASC_PRIVATE_KEY_PATH || !ASC_VENDOR_NUMBER) {
    return {
      configured: false,
      note: 'Set ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY_PATH and ASC_VENDOR_NUMBER (App Store Connect API key with Sales and Reports role).',
    };
  }

  return cached(`ios:${days}`, CACHE_TTL_MS, async () => {
    const token = ascToken();
    // Daily sales reports exist for roughly the last 30 days; yesterday backwards
    const window = Math.min(days, 30);
    const dates = Array.from({ length: window }, (_, i) =>
      fmtDate(new Date(Date.now() - (i + 1) * DAY_MS)),
    );
    const results = await Promise.all(dates.map((d) => fetchAppleDay(token, d).catch(() => null)));

    const daily = dates
      .map((date, i) => ({ date, downloads: results[i] }))
      .filter((d) => d.downloads !== null)
      .reverse();
    return {
      configured: true,
      totalDownloads: daily.reduce((sum, d) => sum + d.downloads, 0),
      daily,
    };
  });
}

// ---------- Google Play ----------

async function googleAccessToken(saKeyPath) {
  const sa = JSON.parse(fs.readFileSync(saKeyPath, 'utf8'));
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_only',
      aud: 'https://oauth2.googleapis.com/token',
    },
    sa.private_key,
    { algorithm: 'RS256', expiresIn: '1h' },
  );
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange ${resp.status}`);
  return (await resp.json()).access_token;
}

async function fetchPlayMonth(accessToken, bucket, yyyymm) {
  const object = encodeURIComponent(
    `stats/installs/installs_${PACKAGE_NAME}_${yyyymm}_overview.csv`,
  );
  const resp = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (resp.status === 404) return []; // month not exported yet
  if (!resp.ok) throw new Error(`Play stats fetch ${resp.status}`);

  // Play Console CSV exports are UTF-16LE
  const csv = Buffer.from(await resp.arrayBuffer())
    .toString('utf16le')
    .replace(/^﻿/, '');
  const [headerLine, ...rows] = csv.split('\n').filter(Boolean);
  const headers = headerLine.split(',').map((h) => h.trim());
  const dateIdx = headers.indexOf('Date');
  const installsIdx = headers.indexOf('Daily User Installs');
  const activeIdx = headers.indexOf('Active Device Installs');

  return rows.map((row) => {
    const cols = row.split(',');
    return {
      date: cols[dateIdx],
      installs: Number(cols[installsIdx]) || 0,
      activeDevices: Number(cols[activeIdx]) || 0,
    };
  });
}

async function getAndroidDownloads(days) {
  const { PLAY_STATS_BUCKET, GOOGLE_PLAY_SA_KEY_PATH } = process.env;
  if (!PLAY_STATS_BUCKET || !GOOGLE_PLAY_SA_KEY_PATH) {
    return {
      configured: false,
      note: 'Set PLAY_STATS_BUCKET (Play Console → Download reports → Copy Cloud Storage URI) and GOOGLE_PLAY_SA_KEY_PATH.',
    };
  }

  return cached(`android:${days}`, CACHE_TTL_MS, async () => {
    const token = await googleAccessToken(GOOGLE_PLAY_SA_KEY_PATH);
    const since = new Date(Date.now() - days * DAY_MS);
    const months = [];
    const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
    while (cursor <= new Date()) {
      months.push(fmtDate(cursor).slice(0, 7).replace('-', ''));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const rows = (await Promise.all(months.map((m) => fetchPlayMonth(token, PLAY_STATS_BUCKET, m))))
      .flat()
      .filter((r) => r.date >= fmtDate(since));

    const latest = rows[rows.length - 1];
    return {
      configured: true,
      totalInstalls: rows.reduce((sum, r) => sum + r.installs, 0),
      activeDevices: latest ? latest.activeDevices : null,
      daily: rows.map(({ date, installs }) => ({ date, installs })),
    };
  });
}

module.exports = { getIosDownloads, getAndroidDownloads };
