const { ObjectId } = require('mongodb');
const escapeRegex = require('../utils/escapeRegex');
const { TOOL_DEFINITIONS, executeToolCall } = require('../kaori-tools');

const WEB_BASE = 'https://thetrickbook.com';
const API_BASE = 'https://api.thetrickbook.com/api';
const LEGACY_READ_TOOLS = new Set([
  'search_spots',
  'search_trickipedia',
  'search_films',
  'lookup_boardsport_knowledge',
]);

const tool = (name, description, properties, required = []) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
});

const PUBLIC_TOOLS = [
  ...TOOL_DEFINITIONS.filter((entry) => LEGACY_READ_TOOLS.has(entry.function.name)).map(
    (entry) => ({
      name: entry.function.name,
      description: entry.function.description,
      inputSchema: { ...entry.function.parameters, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }),
  ),
  tool(
    'get_spot',
    'Get full public details for one approved TrickBook action-sports spot.',
    { id: { type: 'string', description: 'TrickBook spot ID returned by search_spots' } },
    ['id'],
  ),
  tool(
    'get_trick',
    'Get full tutorial and progression details for one TrickBook trick.',
    { id_or_slug: { type: 'string', description: 'TrickBook trick ID or URL slug' } },
    ['id_or_slug'],
  ),
  tool(
    'search_events',
    'Search upcoming action-sports competitions, premieres, community events, and sessions in TrickBook.',
    {
      query: { type: 'string', description: 'Event, series, or organizer name' },
      sport: { type: 'string', description: 'Sport, such as snowboarding, skateboarding, surfing, BMX, or skiing' },
      location: { type: 'string', description: 'City, state/region, or country' },
      registration_open: { type: 'boolean', description: 'Only return events with open registration' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    },
  ),
  tool(
    'get_event',
    'Get full public details for one TrickBook action-sports event.',
    { slug_or_id: { type: 'string', description: 'Event slug or TrickBook event ID' } },
    ['slug_or_id'],
  ),
];

const clean = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const jsonSafe = (value) => JSON.parse(JSON.stringify(value));

async function getSpot(args, db) {
  if (!ObjectId.isValid(args.id)) throw new Error('Invalid spot ID');
  const spot = await db.collection('spots').findOne(
    { _id: new ObjectId(args.id), approvalStatus: 'approved' },
    { projection: { userId: 0, userPhotos: 0, submittedBy: 0, submittedAt: 0 } },
  );
  if (!spot) throw new Error('Spot not found');
  return { spot: jsonSafe(spot), source_url: `${API_BASE}/spots/${spot._id}` };
}

async function getTrick(args, db) {
  const value = clean(args.id_or_slug);
  const or = [{ url: value }];
  if (ObjectId.isValid(value)) or.push({ _id: new ObjectId(value) });
  const trick = await db.collection('tricks').findOne({ $or: or });
  if (!trick) throw new Error('Trick not found');
  return {
    trick: jsonSafe(trick),
    source_url: trick.url
      ? `${WEB_BASE}/trickipedia/${String(trick.category || '').toLowerCase()}/${trick.url}`
      : null,
  };
}

async function searchEvents(args, db) {
  const now = new Date();
  const and = [{ $or: [{ endAt: { $gte: now } }, { endAt: null, startAt: { $gte: now } }, { endAt: { $exists: false }, startAt: { $gte: now } }] }];
  const query = clean(args.query);
  if (query) {
    const rx = { $regex: escapeRegex(query), $options: 'i' };
    and.push({ $or: [{ title: rx }, { 'organizer.name': rx }, { series: rx }] });
  }
  const sport = clean(args.sport, 40);
  if (sport) and.push({ sports: { $regex: `^${escapeRegex(sport)}$`, $options: 'i' } });
  const location = clean(args.location);
  if (location) {
    const rx = { $regex: escapeRegex(location), $options: 'i' };
    and.push({ $or: [{ 'venue.city': rx }, { 'venue.region': rx }, { 'venue.country': rx }] });
  }
  if (args.registration_open === true) and.push({ 'participation.registrationStatus': 'open' });
  const limit = Math.min(10, Math.max(1, Number.parseInt(args.limit, 10) || 5));
  const events = await db.collection('events').find({ $and: and }).sort({ startAt: 1 }).limit(limit).toArray();
  return {
    results: events.map((event) => ({
      id: String(event._id),
      slug: event.slug,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      sports: event.sports || [],
      venue: event.venue || null,
      organizer: event.organizer || null,
      registrationStatus: event.participation?.registrationStatus || null,
      source_url: event.slug ? `${WEB_BASE}/events/${event.slug}` : `${API_BASE}/events/${event._id}`,
    })),
    total_returned: events.length,
  };
}

async function getEvent(args, db) {
  const value = clean(args.slug_or_id);
  const or = [{ slug: value }];
  if (ObjectId.isValid(value)) or.push({ _id: new ObjectId(value) });
  const event = await db.collection('events').findOne({ $or: or });
  if (!event) throw new Error('Event not found');
  return {
    event: jsonSafe(event),
    source_url: event.slug ? `${WEB_BASE}/events/${event.slug}` : `${API_BASE}/events/${event._id}`,
  };
}

async function executePublicTool(name, args, db) {
  if (LEGACY_READ_TOOLS.has(name)) return executeToolCall(name, args, db, '');
  if (name === 'get_spot') return getSpot(args, db);
  if (name === 'get_trick') return getTrick(args, db);
  if (name === 'search_events') return searchEvents(args, db);
  if (name === 'get_event') return getEvent(args, db);
  throw new Error(`Unknown or unavailable public tool: ${name}`);
}

module.exports = { PUBLIC_TOOLS, executePublicTool };
