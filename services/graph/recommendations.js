const { ObjectId } = require('mongodb');

const projection = {
  name: 1,
  url: 1,
  category: 1,
  sportTypes: 1,
  difficulty: 1,
  images: 1,
  progression: 1,
};

function toRecommendation(trick, reason, score) {
  return {
    sourceId: String(trick._id || trick.sourceId),
    name: trick.name,
    slug: trick.url || trick.slug || '',
    sport: trick.sportTypes?.[0] || trick.category || trick.sport || '',
    difficulty: trick.difficulty || '',
    image: trick.images?.[0] || null,
    reason,
    score,
  };
}

async function graphRecommendations(graph, riderId, sport, limit) {
  const rows = await graph.run(
    `MATCH (r:Rider {sourceId: $riderId})-[:LANDED]->(landed:Trick)
     MATCH (landed)-[:NEXT_STEP|PREREQUISITE_OF]->(candidate:Trick)
     WHERE NOT (r)-[:LANDED]->(candidate) AND ($sport = '' OR candidate.sport = $sport)
     OPTIONAL MATCH (required:Trick)-[:PREREQUISITE_OF]->(candidate)
     WITH r, candidate, collect(DISTINCT required) AS requirements, count(DISTINCT landed) AS signals
     WHERE all(required IN requirements WHERE (r)-[:LANDED]->(required))
     RETURN candidate.sourceId, candidate.name, candidate.slug, candidate.sport,
            candidate.difficulty, signals
     ORDER BY signals DESC, candidate.name ASC LIMIT $limit`,
    { riderId: String(riderId), sport: sport || '', limit },
  );
  return rows.map(([sourceId, name, slug, itemSport, difficulty, signals]) => ({
    sourceId,
    name,
    slug,
    sport: itemSport,
    difficulty,
    image: null,
    reason: 'Builds on tricks you have already landed',
    score: Number(signals || 1),
  }));
}

async function mongoRecommendations(db, riderId, sport, limit) {
  const ownerIds = [String(riderId)];
  if (ObjectId.isValid(riderId)) ownerIds.push(new ObjectId(riderId));
  const lists = await db
    .collection('tricklists')
    .find({ 'user.$id': { $in: ownerIds } })
    .toArray();
  const personalIds = lists.flatMap((list) => (list.tricks || []).map((item) => item._id));
  const landedPersonal = personalIds.length
    ? await db
        .collection('tricks')
        .find({ _id: { $in: personalIds }, checked: 'Landed' })
        .toArray()
    : [];
  const landedNames = new Set(
    landedPersonal
      .map((item) =>
        String(item.name || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const query = {};
  if (sport) query.$or = [{ sportTypes: sport }, { category: sport }];
  const catalog = await db.collection('trickipedia').find(query).project(projection).toArray();
  const catalogById = new Map(catalog.map((item) => [String(item._id), item]));
  const candidates = new Map();

  for (const trick of catalog) {
    if (
      !landedNames.has(
        String(trick.name || '')
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    for (const edge of trick.progression?.nextSteps || []) {
      if (!['reviewed', 'published'].includes(edge.research?.status)) continue;
      const candidate = catalogById.get(String(edge.trickId));
      if (
        !candidate ||
        landedNames.has(
          String(candidate.name || '')
            .trim()
            .toLowerCase(),
        )
      )
        continue;
      const current = candidates.get(String(candidate._id)) || { trick: candidate, score: 0 };
      current.score += 2;
      candidates.set(String(candidate._id), current);
    }
  }

  if (!candidates.size) {
    for (const trick of catalog
      .filter((item) => /beginner|easy/i.test(item.difficulty || ''))
      .slice(0, limit)) {
      if (
        !landedNames.has(
          String(trick.name || '')
            .trim()
            .toLowerCase(),
        )
      ) {
        candidates.set(String(trick._id), { trick, score: 1 });
      }
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.trick.name.localeCompare(b.trick.name))
    .slice(0, limit)
    .map(({ trick, score }) =>
      toRecommendation(
        trick,
        score > 1
          ? 'Builds on tricks you have already landed'
          : 'A good foundation for your progression',
        score,
      ),
    );
}

module.exports = { graphRecommendations, mongoRecommendations };
