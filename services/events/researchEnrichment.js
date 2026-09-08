const ENRICHMENT = {
  'xgames:japan-2023': { videos: ['https://www.youtube.com/watch?v=VwAgmNWcmW4'] },
  'xgames:california-2023': { videos: ['https://www.youtube.com/watch?v=_hqk7vCXbo4'] },
  'xgames:aspen-2024': { videos: ['https://www.youtube.com/watch?v=LyPbJoVxyRg'] },
  'xgames:ventura-2024': { videos: ['https://www.youtube.com/watch?v=1mauSm7gFKw'] },
  'xgames:chiba-2024': { videos: ['https://www.youtube.com/watch?v=qvHYaOAOaHY'] },
  'xgames:aspen-2025': { videos: ['https://www.youtube.com/watch?v=ag6pzCmNlfM'] },
  'xgames:osaka-2025': { videos: ['https://www.youtube.com/watch?v=cLVQtB0G0fQ'] },
  'xgames:salt-lake-city-2025': { videos: ['https://www.youtube.com/watch?v=NBBkL4njpGQ'] },
  'xgames:aspen-2026': { videos: ['https://www.youtube.com/watch?v=_E4xed5sAMM'] },
  'xgames:sacramento-2026': {
    researchVerifiedAt: new Date('2026-09-03T22:58:00Z'),
    videos: ['https://www.youtube.com/watch?v=MAxxXGwxH_8'],
    override: {
      aliases: ['X Games Sacramento 2026', 'Sacramento 2026'],
      title: 'MoonPay X Games Sacramento 2026',
      description:
        'The opening stop of the inaugural MoonPay X Games League summer season brought nearly 100 elite athletes to Cal Expo for 18 Skateboard, BMX, and Moto X competitions, plus live music and a festival village.',
      sports: ['skateboarding', 'bmx', 'motocross'],
      disciplines: ['park', 'street', 'vert', 'dirt', 'best-trick', 'best-whip'],
      eventKinds: ['competition', 'festival', 'concert'],
      intents: ['spectate_online'],
      level: ['pro', 'invitational'],
      startAt: new Date('2026-06-26T22:00:00Z'),
      endAt: new Date('2026-06-29T04:00:00Z'),
      timezone: 'America/Los_Angeles',
      timeTba: false,
      status: 'completed',
      venue: {
        name: 'Cal Expo',
        address: '1600 Exposition Blvd',
        city: 'Sacramento',
        region: 'California',
        postalCode: '95815',
        country: 'United States',
        lat: 38.595337,
        lng: -121.43423,
      },
      organizer: { name: 'X Games', verified: true },
      series: 'MoonPay X Games League — 2026 Summer Season',
      participation: {
        registrationStatus: 'invite_only',
        registrationUrl: '',
        eligibilityText:
          'Professional X Games invitees, X Games League club athletes, and selected free agents; no public athlete registration was offered.',
        divisions: ['Men', 'Women', 'X Games League clubs', 'Free agents'],
        skillLevel: 'Elite/professional',
        registrationNotes:
          'Athlete entry was invitational. Public attendance required a ticket; this completed event no longer has an active registration or ticket call to action.',
      },
      spectating: {
        inPerson: false,
        ticketStatus: 'closed',
        ticketUrl: '',
        ticketPrice: 'Historical: single-day general admission from $19; concerts from $69',
        ticketNotes:
          'Children 5 and under were free with a ticketed adult; concerts were 18+; attendees age 14+ did not require adult supervision.',
        streamUrl: 'https://www.youtube.com/playlist?list=PLc90xcuAVqBo',
        streamStatus: 'replay',
        broadcaster: 'X Games YouTube',
      },
      schedule: {
        timezone: 'America/Los_Angeles',
        notes: 'Official listings label the schedule PST; June times are normalized to Pacific Daylight Time.',
        days: [
          {
            date: '2026-06-26',
            venueHours: '3:00 PM–10:00 PM',
            items: [
              '5:00 PM Men’s BMX Park',
              '6:15 PM Women’s Skateboard Park',
              '7:30 PM Moto X Best Whip',
              '8:30 PM DJ Elliot Sloan',
              '9:30 PM Kaskade',
            ],
          },
          {
            date: '2026-06-27',
            venueHours: '10:00 AM–10:00 PM',
            items: [
              '12:00 PM Men’s Skateboard Vert Best Trick',
              '1:00 PM Men’s Skateboard Street',
              '2:30 PM Dave Mirra BMX Park Best Trick',
              '3:30 PM Women’s Skateboard Vert Best Trick',
              '4:30 PM Men’s Skateboard Park',
              '6:00 PM Moto X Best Trick',
              '7:00 PM Men’s BMX Dirt',
              '8:30 PM Subtronics',
              '9:45 PM Mustard',
            ],
          },
          {
            date: '2026-06-28',
            venueHours: '9:00 AM–9:00 PM',
            items: [
              '11:00 AM Women’s Skateboard Street',
              '12:15 PM Men’s Skateboard Vert',
              '1:30 PM Men’s BMX Street',
              '3:00 PM Women’s BMX Park',
              '4:15 PM BMX Dirt Best Trick',
              '5:00 PM Women’s Skateboard Street Best Trick',
              '6:00 PM Men’s Skateboard Street Best Trick',
              '6:45 PM Women’s Skateboard Vert',
            ],
          },
        ],
      },
      resultsUrl:
        'https://www.xgames.com/news/sunday-closes-historic-finish-for-moonpay-x-games-sacramento-2026/',
      image:
        'https://www.xgames.com/wp-content/uploads/2026/06/MIHARU_OZAWA_WOMENS_BMX_PARK_XGAMES_SACTO_2026_ZIELINSKI_00011.jpg',
      media: {
        images: [
          'https://www.xgames.com/wp-content/uploads/2026/06/MIHARU_OZAWA_WOMENS_BMX_PARK_XGAMES_SACTO_2026_ZIELINSKI_00011.jpg',
          'https://calexpo.com/wp-content/uploads/2026/05/Event-Graphics-700-x-515-3.jpg',
        ],
        videos: [
          {
            label: 'Official X Games Sacramento 2026 replay playlist',
            url: 'https://www.youtube.com/playlist?list=PLc90xcuAVqBo',
          },
        ],
      },
      socialLinks: [
        {
          platform: 'instagram',
          label: 'X Games on Instagram',
          url: 'https://www.instagram.com/xgames/',
        },
        { platform: 'youtube', label: 'X Games videos', url: 'https://www.youtube.com/@XGames' },
      ],
      sourceTrust: 'organizer_and_venue',
      sourceRefs: [
        {
          sourceId: 'xgames:event',
          externalId: 'sacramento-2026',
          url: 'https://www.xgames.com/events/sacramento-2026/',
        },
        {
          sourceId: 'xgames:know-before-you-go',
          externalId: 'Sacramento2026_KBYG',
          url: 'https://www.xgames.com/wp-content/uploads/2026/06/Sacramento2026_KBYG.pdf',
        },
        {
          sourceId: 'calexpo:event',
          externalId: 'x-games-sacramento-2026',
          url: 'https://calexpo.com/event/x-games-sacramento-2026/',
        },
        {
          sourceId: 'calexpo:venue',
          externalId: 'cal-expo',
          url: 'https://calexpo.com/contact-us/',
        },
      ],
      externalLinks: [
        {
          kind: 'official',
          label: 'Official X Games Sacramento event page',
          url: 'https://www.xgames.com/events/sacramento-2026/',
        },
        {
          kind: 'venue',
          label: 'Cal Expo event details and historical ticket information',
          url: 'https://calexpo.com/event/x-games-sacramento-2026/',
        },
        {
          kind: 'schedule',
          label: 'Official know-before-you-go schedule (PDF)',
          url: 'https://www.xgames.com/wp-content/uploads/2026/06/Sacramento2026_KBYG.pdf',
        },
        {
          kind: 'results',
          label: 'Day one results',
          url: 'https://www.xgames.com/news/the-future-of-action-sports-begins-moonpay-x-games-league-opens-2026-season-with-unforgettable-day-one-in-sacramento/',
        },
        {
          kind: 'results',
          label: 'Day two results',
          url: 'https://www.xgames.com/news/moonpay-x-games-sacramento-2026-keeps-the-momentum-going-on-day-two/',
        },
        {
          kind: 'results',
          label: 'Day three results and event recap',
          url: 'https://www.xgames.com/news/sunday-closes-historic-finish-for-moonpay-x-games-sacramento-2026/',
        },
      ],
      uncertaintyNotes: [
        'X Games’ past-events card currently shows June 27–29 and links to an unrelated 2023 results record; the event page, venue calendar, and official event guide consistently support June 26–28, so those stale fields were excluded.',
        'The official event-page social image is a Chiba placeholder; this record uses event-specific X Games and Cal Expo imagery instead.',
      ],
      freshness: { lastVerifiedAt: new Date('2026-09-03T22:58:00Z') },
    },
  },
  'xgames:japan-2026': { videos: ['https://www.youtube.com/watch?v=Np-2TAWcfJo'] },
  'xgames:japan-2026-2': { videos: ['https://www.youtube.com/watch?v=AcZd-gn98v0'] },
  'xgames:new-orleans-2026': { videos: ['https://www.youtube.com/watch?v=boi4Uq1AJTw'] },
  'boardr:4273': {
    registrationUrl: 'https://www.theboardr.com/events/4273/Des_Moines_Streetstyle_Open',
    officialUrl: 'https://skatedsm.org/streetstyleopen/',
    videos: ['https://www.youtube.com/watch?v=AdcHOAFhKKQ'],
  },
  'boardr:4309': {
    registrationUrl: 'https://www.theboardr.com/events/4309',
    officialUrl: 'https://skatedsm.org/streetstyleopen/',
    videos: ['https://www.youtube.com/watch?v=AdcHOAFhKKQ'],
  },
  'boardr:4299': {
    officialUrl: 'https://exposureskate.org/',
    videos: ['https://www.youtube.com/watch?v=w4WvpGkmvj4'],
  },
  'boardr:4363': {
    officialUrl: 'https://www.swampfestbmx.com/',
    registrationUrl: 'https://swampfestwaiver.vercel.app/',
    videos: ['https://www.youtube.com/watch?v=z36Ad8XVVjQ'],
  },
};

function uniqueByUrl(items) {
  const seen = new Set();
  return items.filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}

function applyResearchEnrichment(event) {
  const data = ENRICHMENT[event.sourceId];
  const officialLinks = [
    ...(event.externalLinks || []),
    { kind: 'official', label: 'Official event details', url: event.sourceUrl },
  ];
  if (!data) {
    return {
      ...event,
      externalLinks: uniqueByUrl(officialLinks),
      researchVerifiedAt: new Date('2026-09-02T22:21:14Z'),
    };
  }

  const registrationUrl = data.registrationUrl || event.participation?.registrationUrl || '';
  const override = data.override || {};
  const externalLinks = [
    ...officialLinks,
    ...(override.externalLinks || []),
    ...(data.officialUrl
      ? [{ kind: 'official', label: 'Organizer event information', url: data.officialUrl }]
      : []),
    ...(data.registrationUrl
      ? [{ kind: 'registration', label: 'Register or complete the participant waiver', url: data.registrationUrl }]
      : []),
  ];
  const videos = [
    ...(event.media?.videos || []),
    ...(override.media?.videos || []),
    ...(data.videos || []).map((url) => ({ label: 'Previous event video or replay', url })),
  ];
  return {
    ...event,
    ...override,
    participation: {
      ...(event.participation || {}),
      ...(override.participation || {}),
      registrationUrl,
      ...(data.registrationUrl ? { registrationStatus: 'open' } : {}),
    },
    spectating: { ...(event.spectating || {}), ...(override.spectating || {}) },
    media: { ...(event.media || {}), ...(override.media || {}), videos: uniqueByUrl(videos) },
    externalLinks: uniqueByUrl(externalLinks),
    researchVerifiedAt: data.researchVerifiedAt || new Date('2026-09-02T22:21:14Z'),
  };
}

module.exports = { applyResearchEnrichment };
