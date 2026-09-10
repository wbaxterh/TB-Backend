const { ObjectId } = require('mongodb');

const EDGE_COLLECTION = process.env.COMPANION_GRAPH_COLLECTION || 'companion_graph_edges';
const WEB_BASE = 'https://thetrickbook.com';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trickUrl(trick) {
  return trick?.url
    ? `${WEB_BASE}/trickipedia/${String(trick.category || '').toLowerCase()}/${trick.url}`
    : null;
}

function filmUrl(film) {
  return film?.slug ? `${WEB_BASE}/media/couch/${film.slug}` : null;
}

function spotUrl(spot) {
  return spot?._id ? `${WEB_BASE}/spots/${spot._id}` : null;
}

async function findTrick(db, name) {
  if (!name) return null;
  const exact = new RegExp(`^${escapeRegex(name)}$`, 'i');
  return db.collection('trickipedia').findOne({ $or: [{ name: exact }, { aliases: exact }] });
}

async function findSpot(db, name) {
  if (!name) return null;
  const exact = new RegExp(`^${escapeRegex(name)}$`, 'i');
  const partial = new RegExp(escapeRegex(name), 'i');
  return (
    (await db.collection('spots').findOne({ $or: [{ name: exact }, { aliases: exact }] })) ||
    db.collection('spots').findOne({ $or: [{ name: partial }, { city: partial }] })
  );
}

async function filmsFeaturingTrick(db, trickName) {
  const trick = await findTrick(db, trickName);
  if (!trick) return { results: [], message: `No TrickBook trick matched "${trickName}".` };
  const edges = await db
    .collection(EDGE_COLLECTION)
    .find({ relation: 'MENTIONS_TRICK', 'to.id': String(trick._id) })
    .sort({ confidence: -1 })
    .limit(10)
    .toArray();
  const ids = edges.map((edge) => new ObjectId(edge.from.id));
  const films = ids.length
    ? await db
        .collection('couch_videos')
        .find({ _id: { $in: ids }, isPublished: true })
        .toArray()
    : [];
  const byId = new Map(films.map((film) => [String(film._id), film]));
  return {
    trick: { name: trick.name, webUrl: trickUrl(trick) },
    results: edges
      .map((edge) => {
        const film = byId.get(edge.from.id);
        return film
          ? {
              title: film.title,
              riders: (film.riders || []).slice(0, 8),
              webUrl: filmUrl(film),
              evidence: edge.evidence,
            }
          : null;
      })
      .filter(Boolean),
    message:
      edges.length === 0
        ? `No film in TrickBook explicitly mentions ${trick.name} yet; don't claim that a film features it without evidence.`
        : undefined,
  };
}

async function tricksAtSpot(db, spotName) {
  const spot = await findSpot(db, spotName);
  if (!spot) return { results: [], message: `No TrickBook spot matched "${spotName}".` };
  const edges = await db
    .collection(EDGE_COLLECTION)
    .find({ relation: 'PERFORMED_AT', 'to.id': String(spot._id) })
    .sort({ confidence: -1, 'evidence.year': -1 })
    .limit(20)
    .toArray();
  const trickIds = edges.filter((edge) => edge.from.id).map((edge) => new ObjectId(edge.from.id));
  const tricks = trickIds.length
    ? await db
        .collection('trickipedia')
        .find({ _id: { $in: trickIds } })
        .toArray()
    : [];
  const byId = new Map(tricks.map((trick) => [String(trick._id), trick]));
  return {
    spot: { name: spot.name, webUrl: spotUrl(spot) },
    results: edges.map((edge) => {
      const trick = byId.get(edge.from.id);
      return {
        trick: trick?.name || edge.from.label,
        trickUrl: trickUrl(trick),
        skater: edge.evidence?.skaterName,
        year: edge.evidence?.year,
        sourceUrl: edge.evidence?.sourceUrl,
        verified: edge.evidence?.verified,
      };
    }),
  };
}

async function similarTricks(db, trickName, limit = 5) {
  const trick = await findTrick(db, trickName);
  if (!trick) return { results: [], message: `No TrickBook trick matched "${trickName}".` };
  const edges = await db
    .collection(EDGE_COLLECTION)
    .find({ relation: 'SIMILAR_TO', 'from.id': String(trick._id) })
    .sort({ weight: -1 })
    .limit(Math.min(limit, 10))
    .toArray();
  const ids = edges.map((edge) => new ObjectId(edge.to.id));
  const related = ids.length
    ? await db
        .collection('trickipedia')
        .find({ _id: { $in: ids } })
        .toArray()
    : [];
  const byId = new Map(related.map((item) => [String(item._id), item]));
  return {
    base: { name: trick.name, webUrl: trickUrl(trick) },
    results: edges
      .map((edge) => {
        const item = byId.get(edge.to.id);
        return item
          ? {
              name: item.name,
              difficulty: item.difficulty,
              similarity: edge.weight,
              webUrl: trickUrl(item),
            }
          : null;
      })
      .filter(Boolean),
    source: 'trickbook_companion_graph',
  };
}

async function learningPath(db, trickName, completedNames = new Set(), maxDepth = 4) {
  const target = await findTrick(db, trickName);
  if (!target) return { path: [], message: `No TrickBook trick matched "${trickName}".` };
  const allEdges = await db
    .collection(EDGE_COLLECTION)
    .find({ relation: 'PREREQUISITE_OF' })
    .toArray();
  const prerequisites = new Map();
  for (const edge of allEdges) {
    const list = prerequisites.get(edge.to.id) || [];
    list.push(edge.from.id);
    prerequisites.set(edge.to.id, list);
  }
  const ordered = [];
  const visited = new Set();
  function visit(id, depth) {
    if (visited.has(id) || depth > maxDepth) return;
    visited.add(id);
    for (const prerequisite of prerequisites.get(id) || []) visit(prerequisite, depth + 1);
    ordered.push(id);
  }
  visit(String(target._id), 0);
  const ids = ordered.map((id) => new ObjectId(id));
  const tricks = await db
    .collection('trickipedia')
    .find({ _id: { $in: ids } })
    .toArray();
  const byId = new Map(tricks.map((trick) => [String(trick._id), trick]));
  const path = ordered
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((trick) => ({
      name: trick.name,
      difficulty: trick.difficulty,
      completed: completedNames.has(String(trick.name).toLowerCase()),
      webUrl: trickUrl(trick),
    }));
  return {
    target: target.name,
    path,
    next: path.find((step) => !step.completed),
    source: 'trickbook_companion_graph',
  };
}

module.exports = {
  EDGE_COLLECTION,
  filmsFeaturingTrick,
  findSpot,
  findTrick,
  learningPath,
  similarTricks,
  tricksAtSpot,
};
