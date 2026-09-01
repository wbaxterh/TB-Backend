/**
 * The Boardr upcoming skateboarding/BMX event source.
 *
 * The public page is server-rendered by Next.js. Its __NEXT_DATA__ payload
 * contains an eventList array, which is substantially more stable than the
 * generated CSS classes used by the visible cards.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { absoluteUrl, cleanText, dedupeKey, inferDisciplines, slugify } = require('./util');

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseEventDetail(html, url) {
  const $ = cheerio.load(html || '');
  const image = absoluteUrl(
    $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content'),
    url,
  );
  const pageText = cleanText($('main').text() || $('body').text());
  const links = $('a[href]')
    .map((_i, link) => absoluteUrl($(link).attr('href'), url))
    .get();
  const instagramUrls = unique(links.filter((link) => /instagram\.com\//i.test(link)));
  const videoUrls = unique(
    links.filter((link) => /(?:youtube\.com\/watch|youtu\.be\/|vimeo\.com\/)/i.test(link)),
  );
  return { image, instagramUrls, videoUrls, pageText };
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
    disciplines: inferDisciplines(sports, title, description),
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
    media: { images: [], videos: [] },
    socialLinks: [],
    organizer: { name: 'The Boardr', verified: true },
    series: /the boardr series/i.test(title) ? 'The Boardr Series' : '',
    resultsUrl: '',
    sourceTrust: 'registration_partner',
    dedupeKey: dedupeKey({ title, startAt, city: venue.city }),
  };
}

function mergeBoardrDetail(event, detail) {
  const disciplines = inferDisciplines(event.sports, event.title, event.description);
  return {
    ...event,
    image: detail?.image || event.image,
    disciplines: disciplines.length ? disciplines : event.disciplines,
    media: {
      images: unique([detail?.image, ...(event.media?.images || [])]),
      videos: unique(detail?.videoUrls || []).map((url) => ({ url, label: 'Event video' })),
    },
    socialLinks: unique(detail?.instagramUrls || []).map((url) => ({
      platform: 'instagram',
      url,
      label: 'Instagram',
    })),
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
  const events = parseBoardrPage(response.data);
  const enriched = [];
  // Keep detail requests sequential and identified; this feed runs on a cron,
  // and source politeness matters more than shaving a few seconds off ingestion.
  for (const event of events) {
    try {
      const detailResponse = await axios.get(event.sourceUrl, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        timeout: 15000,
      });
      enriched.push(
        mergeBoardrDetail(event, parseEventDetail(detailResponse.data, event.sourceUrl)),
      );
    } catch (error) {
      console.error(`[events:boardr] detail fetch failed for ${event.sourceId}:`, error.message);
      enriched.push(event);
    }
  }
  return enriched;
}

module.exports = {
  fetchBoardrEvents,
  parseBoardrPage,
  normalizeBoardrEvent,
  dateOnlyUtc,
  splitLocation,
  parseEventDetail,
  mergeBoardrDetail,
};
