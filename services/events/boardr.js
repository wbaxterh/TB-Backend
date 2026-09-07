/**
 * The Boardr upcoming skateboarding/BMX event source.
 *
 * The public page is server-rendered by Next.js. Its __NEXT_DATA__ payload
 * contains an eventList array, which is substantially more stable than the
 * generated CSS classes used by the visible cards.
 */
const axios = require('axios');
const { cleanText, dedupeKey, slugify } = require('./util');

const UA = 'TrickBookEventsBot/1.0 (+https://thetrickbook.com; events@thetrickbook.com)';
const EVENTS_URL = 'https://www.theboardr.com/events';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function dateOnlyUtc(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12));
}

function splitLocation(value) {
  const parts = cleanText(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    name: '',
    city: parts.slice(0, -1).join(', ') || parts[0] || '',
    region: parts.length > 1 ? parts.at(-1) : '',
    country: 'USA',
    lat: null,
    lng: null,
  };
}

function eventKindsFor(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  const kinds = [];
  if (/contest|championship|open\b|series/.test(text)) kinds.push('competition');
  if (/jam\b|session|open house/.test(text)) kinds.push('community');
  if (/festival|fest\b|fair\b/.test(text)) kinds.push('festival');
  if (/exhibition|show\b|retrospective/.test(text)) kinds.push('exhibition');
  return kinds.length ? [...new Set(kinds)] : ['event'];
}

function normalizeBoardrEvent(raw) {
  if (!raw?.EventID || !raw?.Title) return null;
  const title = cleanText(decodeHtml(raw.Title));
  const description = cleanText(decodeHtml(raw.ShortDescription));
  const startAt = dateOnlyUtc(raw.StartDate);
  const endAt = dateOnlyUtc(raw.ExpireDate);
  if (!startAt) return null;

  const venue = splitLocation(raw.Location);
  // The numeric URL is canonical enough for navigation and survives title edits.
  const detailsUrl = `${EVENTS_URL}/${raw.EventID}`;
  const inviteOnly = /invite[- ]only/i.test(description);
  const openEntry = /\bopen\b|all ages|all skills/i.test(`${title} ${description}`) && !inviteOnly;
  const sports = /\bbmx\b/i.test(`${title} ${description}`)
    ? ['skateboarding', 'bmx']
    : ['skateboarding'];

  return {
    source: 'boardr',
    sourceId: `boardr:${raw.EventID}`,
    sourceUrl: detailsUrl,
    slug: slugify(`boardr-${raw.EventID}-${title}`),
    title,
    description,
    sports,
    disciplines: [],
    eventKinds: eventKindsFor(title, description),
    intents: openEntry ? ['compete', 'spectate_in_person'] : ['spectate_in_person'],
    level: inviteOnly ? ['pro'] : openEntry ? ['open'] : [],
    startAt,
    endAt,
    timezone: null,
    timeTba: true,
    status: (endAt || startAt) < new Date() ? 'completed' : 'scheduled',
    isOnline: false,
    venue,
    participation: {
      registrationStatus: inviteOnly ? 'invite_only' : openEntry ? 'unknown' : 'unknown',
      registrationUrl: detailsUrl,
    },
    spectating: { inPerson: true, ticketUrl: '', streamUrl: '', streamStatus: '' },
    image: '',
    organizer: { name: 'The Boardr', verified: true },
    series: /the boardr series/i.test(title) ? 'The Boardr Series' : '',
    resultsUrl: '',
    sourceTrust: 'registration_partner',
    dedupeKey: dedupeKey({ title, startAt, city: venue.city }),
  };
}

function parseBoardrPage(html) {
  const match = String(html || '').match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
  );
  if (!match) throw new Error('The Boardr __NEXT_DATA__ payload was not found');

  const payload = JSON.parse(match[1]);
  const eventList = payload?.props?.pageProps?.eventList;
  if (!Array.isArray(eventList)) throw new Error('The Boardr eventList was not found');
  return eventList.map(normalizeBoardrEvent).filter(Boolean);
}

async function fetchBoardrEvents() {
  const response = await axios.get(EVENTS_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: 15000,
  });
  return parseBoardrPage(response.data);
}

module.exports = {
  fetchBoardrEvents,
  parseBoardrPage,
  normalizeBoardrEvent,
  dateOnlyUtc,
  splitLocation,
};
