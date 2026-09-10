const crypto = require('crypto');

const BASE_URL = process.env.FRONTEND_URL || 'https://thetrickbook.com';

function clean(values) {
  return values
    .flat(Infinity)
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => (typeof value === 'object' ? JSON.stringify(value) : String(value)))
    .join(' | ');
}

function slug(doc) {
  return doc.slug || doc.url || String(doc._id);
}

function makeDocument(sourceType, doc, title, parts, webUrl) {
  const content = clean([title, ...parts]);
  return {
    sourceType,
    sourceId: String(doc._id),
    title: title || sourceType,
    content,
    webUrl,
    sport: clean([doc.sport, doc.sportType, doc.sportTypes, doc.category]),
    contentHash: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function trickDocument(doc) {
  return makeDocument(
    'trick',
    doc,
    doc.name,
    [
      doc.aliases,
      doc.category,
      doc.difficulty,
      doc.description,
      doc.steps,
      doc.tips,
      doc.commonMistakes,
    ],
    `${BASE_URL}/trickipedia/${doc.category || 'all'}/${slug(doc)}`,
  );
}

function filmDocument(doc) {
  return makeDocument(
    'film',
    doc,
    doc.title,
    [
      doc.description,
      doc.producedBy,
      doc.filmmaker,
      doc.riders,
      doc.sportTypes,
      doc.releaseYear,
      doc.tags,
    ],
    `${BASE_URL}/media/couch/${slug(doc)}`,
  );
}

function spotDocument(doc) {
  const location = doc.location || {};
  return makeDocument(
    'spot',
    doc,
    doc.name,
    [
      doc.description,
      doc.type,
      doc.features,
      doc.tags,
      location.city,
      location.state,
      location.country,
      doc.address,
    ],
    `${BASE_URL}/spots/${slug(doc)}`,
  );
}

function eventDocument(doc) {
  return makeDocument(
    'event',
    doc,
    doc.name || doc.title,
    [
      doc.description,
      doc.sportTypes,
      doc.eventType,
      doc.venue,
      doc.city,
      doc.region,
      doc.country,
      doc.startDate,
    ],
    doc.webUrl || doc.url || `${BASE_URL}/events/${slug(doc)}`,
  );
}

function riderDocument(doc) {
  return makeDocument(
    'rider',
    doc,
    doc.name || doc.displayName,
    [doc.bio, doc.sports, doc.disciplines, doc.sponsors, doc.hometown, doc.country, doc.aliases],
    `${BASE_URL}/riders/${slug(doc)}`,
  );
}

const SOURCES = [
  { collection: 'trickipedia', sourceType: 'trick', query: {}, transform: trickDocument },
  {
    collection: 'couch_videos',
    sourceType: 'film',
    query: { isPublished: true, type: 'film' },
    transform: filmDocument,
  },
  { collection: 'spots', sourceType: 'spot', query: {}, transform: spotDocument },
  { collection: 'events', sourceType: 'event', query: {}, transform: eventDocument },
  { collection: 'riders', sourceType: 'rider', query: {}, transform: riderDocument },
];

module.exports = { SOURCES, makeDocument };
