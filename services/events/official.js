const { dedupeKey, slugify } = require('./util');

function normalizeOfficialEvent(raw) {
  const startAt = new Date(raw.startAt);
  const endAt = new Date(raw.endAt);
  return {
    source: 'official-calendars',
    sourceId: `official:${raw.id}`,
    sourceUrl: raw.sourceUrl,
    sourceRefs: [{ sourceId: 'official-calendar', externalId: raw.id, url: raw.sourceUrl }],
    slug: slugify(raw.title),
    title: raw.title,
    description: raw.description,
    sports: raw.sports,
    disciplines: raw.disciplines,
    eventKinds: ['competition'],
    intents: raw.registrationUrl ? ['compete', 'spectate_in_person'] : ['spectate_in_person'],
    level: ['pro'],
    startAt,
    endAt,
    timezone: null,
    timeTba: true,
    status: endAt < new Date() ? 'completed' : 'scheduled',
    venue: { name: '', city: raw.city, region: raw.region || '', country: raw.country },
    participation: {
      registrationStatus: raw.registrationUrl ? 'open' : 'federation_only',
      registrationUrl: raw.registrationUrl || '',
    },
    spectating: { inPerson: true, ticketUrl: '', streamUrl: '', streamStatus: '' },
    organizer: { name: raw.organizer, verified: true },
    sourceTrust: 'governing_body',
    externalLinks: [
      { kind: 'official', label: 'Official event information', url: raw.sourceUrl },
      ...(raw.registrationUrl
        ? [
            {
              kind: 'registration',
              label: 'Registration and athlete information',
              url: raw.registrationUrl,
            },
          ]
        : []),
    ],
    socialLinks: [
      { platform: 'instagram', label: `${raw.organizer} on Instagram`, url: raw.instagram },
      { platform: 'youtube', label: `${raw.organizer} videos`, url: raw.youtube },
    ],
    media: {
      images: [],
      videos: [{ label: 'Event videos and replays', url: raw.youtube }],
    },
    image: '',
    dedupeKey: dedupeKey({ title: raw.title, startAt, city: raw.city }),
  };
}

const EVENTS = [
  {
    id: 'crankworx-mont-sainte-anne-2026',
    title: 'Crankworx Mont-Sainte-Anne 2026',
    description:
      'The Crankworx World Tour finale with slopestyle, downhill, pump track, and open amateur racing.',
    startAt: '2026-09-03T12:00:00Z',
    endAt: '2026-09-07T23:59:00Z',
    sports: ['mtb'],
    disciplines: ['slopestyle', 'downhill', 'pump-track'],
    city: 'BeauprÃ©',
    region: 'Quebec',
    country: 'Canada',
    organizer: 'Crankworx',
    sourceUrl: 'https://www.crankworx.com/',
    registrationUrl: 'https://www.crankworx.com/account/',
    instagram: 'https://www.instagram.com/crankworx/',
    youtube: 'https://www.youtube.com/@Crankworx',
  },
  {
    id: 'bmx-freestyle-pan-american-championships-2026',
    title: 'BMX Freestyle Pan American Championships 2026',
    description: 'The continental BMX freestyle championships for qualified national-team riders.',
    startAt: '2026-09-19T12:00:00Z',
    endAt: '2026-09-20T23:59:00Z',
    sports: ['bmx'],
    disciplines: ['park', 'flatland'],
    city: 'TBA',
    country: 'TBA',
    organizer: 'USA Cycling',
    sourceUrl: 'https://usacycling.org/team-usa/bmx-freestyle',
    instagram: 'https://www.instagram.com/usacycling/',
    youtube: 'https://www.youtube.com/@USACycling',
  },
  {
    id: 'world-skate-games-2026',
    title: 'World Skate Games 2026',
    description:
      'World championships spanning skateboarding street and park, roller freestyle, scooter, and other World Skate disciplines.',
    startAt: '2026-10-02T12:00:00Z',
    endAt: '2026-10-18T23:59:00Z',
    sports: ['skateboarding', 'rollerblading', 'scooter'],
    disciplines: ['street', 'park', 'roller-freestyle'],
    city: 'AsunciÃ³n',
    country: 'Paraguay',
    organizer: 'World Skate',
    sourceUrl: 'https://www.worldskate.org/',
    instagram: 'https://www.instagram.com/worldskateofficial/',
    youtube: 'https://www.youtube.com/@WorldSkateOfficial',
  },
  {
    id: 'uci-bmx-freestyle-world-cup-shanghai-2026',
    title: 'UCI BMX Freestyle World Cup Shanghai 2026',
    description:
      'Round three of the UCI BMX Freestyle World Cup, featuring menâ€™s and womenâ€™s Park and Flatland.',
    startAt: '2026-10-15T12:00:00Z',
    endAt: '2026-10-18T23:59:00Z',
    sports: ['bmx'],
    disciplines: ['park', 'flatland'],
    city: 'Shanghai',
    country: 'China',
    organizer: 'UCI',
    sourceUrl:
      'https://www.uci.org/pressrelease/the-uci-unveils-the-2026-uci-bmx-freestyle-world-cup-calendar/13fBUvoQmYPGR4wMMfgR6z',
    instagram: 'https://www.instagram.com/uci_cycling/',
    youtube: 'https://www.youtube.com/@ucichannel',
  },
  {
    id: 'bmx-freestyle-world-championships-2026',
    title: 'BMX Freestyle World Championships 2026',
    description: 'The 2026 BMX Freestyle World Championships for qualified national-team athletes.',
    startAt: '2026-11-03T12:00:00Z',
    endAt: '2026-11-07T23:59:00Z',
    sports: ['bmx'],
    disciplines: ['park', 'flatland'],
    city: 'Riyadh',
    country: 'Saudi Arabia',
    organizer: 'UCI',
    sourceUrl: 'https://usacycling.org/team-usa/bmx-freestyle',
    instagram: 'https://www.instagram.com/uci_cycling/',
    youtube: 'https://www.youtube.com/@ucichannel',
  },
  {
    id: 'uci-bmx-freestyle-world-cup-final-2026',
    title: 'UCI BMX Freestyle World Cup Final 2026',
    description:
      'The fourth and final 2026 UCI BMX Freestyle World Cup round; host venue remains to be confirmed.',
    startAt: '2026-11-26T12:00:00Z',
    endAt: '2026-11-29T23:59:00Z',
    sports: ['bmx'],
    disciplines: ['park', 'flatland'],
    city: 'TBA',
    country: 'TBA',
    organizer: 'UCI',
    sourceUrl:
      'https://www.uci.org/pressrelease/the-uci-unveils-the-2026-uci-bmx-freestyle-world-cup-calendar/13fBUvoQmYPGR4wMMfgR6z',
    instagram: 'https://www.instagram.com/uci_cycling/',
    youtube: 'https://www.youtube.com/@ucichannel',
  },
];

async function fetchOfficialEvents() {
  return EVENTS.map(normalizeOfficialEvent);
}

module.exports = { fetchOfficialEvents, normalizeOfficialEvent };
