/**
 * Shared helpers for event ingestion (slugs, date-range parsing, sport
 * inference, normalization).
 */

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function cleanText(str) {
  return String(str || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a human date range into { startAt, endAt } (UTC Dates).
 * Handles: "July 24 - 26, 2026", "July 4 - 5, 2026", "June 27, 2026",
 * "January 30 - February 2, 2026".
 */
function parseDateRange(raw) {
  const str = cleanText(raw).replace(/[–—]/g, '-'); // en/em dash -> hyphen
  if (!str) return { startAt: null, endAt: null };

  const yearMatch = str.match(/(\d{4})\s*$/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear();

  const mk = (monthName, day) => {
    const m = MONTHS[String(monthName || '').toLowerCase()];
    if (m === undefined || !day) return null;
    // Noon UTC so the calendar day is stable when rendered in any US timezone.
    return new Date(Date.UTC(year, m, Number(day), 12));
  };

  // Cross-month: "Month D - Month D, YYYY"
  let m = str.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2})/);
  if (m) return { startAt: mk(m[1], m[2]), endAt: mk(m[3], m[4]) };

  // Same-month: "Month D - D, YYYY"
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2})/);
  if (m) return { startAt: mk(m[1], m[2]), endAt: mk(m[1], m[3]) };

  // Single day: "Month D, YYYY"
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2})/);
  if (m) return { startAt: mk(m[1], m[2]), endAt: null };

  return { startAt: null, endAt: null };
}

// Winter (Nov-Mar) X Games are ski/snow; the rest are skate/BMX. Rough but
// reasonable for multi-sport marquee events that expose no per-event sport.
function inferSportsFromDate(startAt) {
  if (!startAt) return ['skateboarding', 'bmx'];
  const month = new Date(startAt).getUTCMonth(); // 0-11
  const winter = month >= 10 || month <= 2; // Nov, Dec, Jan, Feb, Mar
  return winter ? ['snowboarding', 'skiing'] : ['skateboarding', 'bmx'];
}

// A stable key for de-duplication across sources/re-runs.
function dedupeKey({ title, startAt, city }) {
  return [
    slugify(title),
    startAt ? new Date(startAt).toISOString().slice(0, 10) : 'nodate',
    slugify(city),
  ]
    .filter(Boolean)
    .join('|');
}

module.exports = { slugify, cleanText, parseDateRange, inferSportsFromDate, dedupeKey, MONTHS };
