/**
 * Grassroots film-premiere / culture source for the events calendar.
 *
 * This is the "cool stuff you go to for a good time" lane: snowboard + skate
 * video premieres, shop nights, mag release parties, DIY jams. Unlike the comp
 * feeds (xgames/boardr/official) these aren't governing-body events — they're
 * curated by hand from crew/shop/mag announcements (Instagram, shop sites).
 *
 * Pattern mirrors official.js: a hand-curated EVENTS array run through a
 * normalizer. To add a premiere: drop an entry in EVENTS with a real date and
 * flip timeTba to false once it's confirmed. The seasonal monitor (see
 * HEARTBEAT.md) is what keeps this array fresh through premiere season.
 *
 * NOTE: entries with `timeTba: true` use an *estimated* date window (the crew's
 * historical release slot). They render with a "date TBA" flag until confirmed.
 */
const { dedupeKey, slugify, cleanText } = require('./util');

function normalizePremiereEvent(raw) {
  const startAt = raw.startAt ? new Date(raw.startAt) : null;
  const endAt = raw.endAt ? new Date(raw.endAt) : startAt;
  const hasTicket = Boolean(raw.ticketUrl);
  return {
    source: 'premieres',
    sourceId: `premieres:${raw.id}`,
    sourceUrl: raw.sourceUrl || raw.instagram || '',
    sourceRefs: [{ sourceId: 'premieres', externalId: raw.id, url: raw.sourceUrl || '' }],
    slug: slugify(raw.title),
    title: cleanText(raw.title),
    description: cleanText(raw.description),
    sports: raw.sports || [],
    disciplines: raw.disciplines || [],
    eventKinds: ['premiere'],
    intents: ['spectate_in_person', 'community'],
    level: ['all'],
    startAt,
    endAt,
    timezone: raw.timezone || null,
    // Premieres are evening events; default to TBA time unless a slot is given.
    timeTba: raw.timeTba !== undefined ? raw.timeTba : true,
    status: endAt && endAt < new Date() ? 'completed' : 'scheduled',
    venue: {
      name: raw.venue || '',
      city: raw.city || '',
      region: raw.region || '',
      country: raw.country || 'USA',
    },
    participation: {
      registrationStatus: hasTicket ? 'open' : 'unknown',
      registrationUrl: raw.ticketUrl || '',
      eligibilityText: raw.eligibilityText || 'Open to the public',
    },
    spectating: {
      inPerson: true,
      ticketUrl: raw.ticketUrl || '',
      streamUrl: raw.streamUrl || '',
      streamStatus: raw.streamUrl ? 'expected' : '',
    },
    organizer: { name: raw.organizer, verified: false },
    sourceTrust: 'community_source',
    externalLinks: [
      raw.sourceUrl && { kind: 'official', label: `${raw.organizer} announcement`, url: raw.sourceUrl },
      raw.ticketUrl && { kind: 'tickets', label: 'Tickets / entry', url: raw.ticketUrl },
    ].filter(Boolean),
    socialLinks: [
      raw.instagram && { platform: 'instagram', label: `${raw.organizer} on Instagram`, url: raw.instagram },
      raw.youtube && { platform: 'youtube', label: `${raw.organizer} on YouTube`, url: raw.youtube },
    ].filter(Boolean),
    media: {
      images: [],
      videos: raw.trailerUrl ? [{ label: 'Trailer', url: raw.trailerUrl }] : [],
    },
    image: raw.image || '',
    dedupeKey: dedupeKey({ title: raw.title, startAt, city: raw.city }),
  };
}

/**
 * Curated premiere circuit. Dates marked `timeTba: true` are estimated from the
 * crew's historical release window and MUST be confirmed before they mean much.
 * As of the 2026-27 season kickoff these had not been officially dated yet.
 */
const EVENTS = [
  {
    id: 'dustbox-2026',
    title: 'dustbox 2026 Video Premiere',
    description:
      'SLC street snowboarding crew dustbox drops a new full-length every fall (NEEDED YOU 2023, SPIRIT 2024, REPTILE 2025). Free release, usually late October / early November. Title and premiere date TBA — watch @dustboxdustbox.',
    startAt: '2026-10-30T00:00:00Z',
    endAt: '2026-10-30T23:59:00Z',
    timeTba: true,
    sports: ['snowboarding'],
    disciplines: ['street'],
    venue: '',
    city: 'Salt Lake City',
    region: 'Utah',
    country: 'USA',
    organizer: 'dustbox',
    sourceUrl: 'https://www.dustbox.org/',
    instagram: 'https://www.instagram.com/dustboxdustbox/',
    youtube: 'https://www.youtube.com/@dustboxdustbox',
  },
  {
    id: 'slc-shop-premiere-weekend-2026',
    title: 'SLC Snowboard Premiere Weekend 2026',
    description:
      'The annual Salt Lake City shop premiere run — Milosport, Evo, and the Torment Magazine warehouse party stack team-movie premieres over one weekend to kick off the season. Historically the first week of November. Lineup and dates TBA.',
    startAt: '2026-11-05T00:00:00Z',
    endAt: '2026-11-07T23:59:00Z',
    timeTba: true,
    sports: ['snowboarding'],
    disciplines: ['street', 'backcountry'],
    venue: 'Milosport / Evo / Torment warehouse',
    city: 'Salt Lake City',
    region: 'Utah',
    country: 'USA',
    organizer: 'Milosport / Evo / Torment Magazine',
    sourceUrl: 'https://www.milosport.com/',
    instagram: 'https://www.instagram.com/milosport/',
  },
];

async function fetchPremieresEvents() {
  return EVENTS.map(normalizePremiereEvent);
}

module.exports = { fetchPremieresEvents, normalizePremiereEvent };
