#!/usr/bin/env node
require('dotenv').config();

const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { EDGE_COLLECTION } = require('../companion-graph/graph');
const { normalizeIdentityPart } = require('../services/riders/editorialRider');

const GENERATOR = 'phase3-v1';

function edgeId(from, relation, to, evidenceKey = '') {
  return crypto
    .createHash('sha256')
    .update(`${from.type}:${from.id}|${relation}|${to.type}:${to.id}|${evidenceKey}`)
    .digest('hex');
}

function edge(from, relation, to, options = {}) {
  return {
    _id: edgeId(from, relation, to, options.evidenceKey),
    from,
    relation,
    to,
    weight: options.weight ?? 1,
    confidence: options.confidence || 'high',
    evidence: options.evidence || {},
    generator: GENERATOR,
    generatedAt: new Date(),
  };
}

function referencedId(item) {
  return item?.trickId || item?.id || item?._id || item;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function mentions(text, name) {
  if (!name || name.length < 4) return false;
  return new RegExp(
    `(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
    'i',
  ).test(text);
}

async function buildEdges(db) {
  const [tricks, films, riders, history, trickVectors] = await Promise.all([
    db.collection('trickipedia').find({}).toArray(),
    db.collection('couch_videos').find({ isPublished: true, type: 'film' }).toArray(),
    db.collection('riders').find({ reviewStatus: 'published' }).toArray(),
    db.collection('spot_trick_history').find({}).toArray(),
    db
      .collection(process.env.KAORI_RAG_COLLECTION || 'kaori_knowledge_chunks')
      .find({ sourceType: 'trick' })
      .project({ sourceId: 1, embedding: 1 })
      .toArray(),
  ]);

  const edges = [];
  const trickById = new Map(tricks.map((trick) => [String(trick._id), trick]));
  const trickByName = new Map();
  for (const trick of tricks) {
    for (const name of [trick.name, ...(trick.aliases || [])]) {
      trickByName.set(normalizeIdentityPart(name), trick);
    }
  }

  for (const trick of tricks) {
    const to = { type: 'Trick', id: String(trick._id), label: trick.name };
    for (const item of trick.progression?.prerequisites || []) {
      const prerequisite = trickById.get(String(referencedId(item)));
      if (!prerequisite) continue;
      edges.push(
        edge(
          { type: 'Trick', id: String(prerequisite._id), label: prerequisite.name },
          'PREREQUISITE_OF',
          to,
          { weight: item.strength || 1, evidence: { source: 'trickipedia.progression' } },
        ),
      );
    }
  }

  const vectorById = new Map(trickVectors.map((item) => [item.sourceId, item.embedding]));
  for (const trick of tricks) {
    const vector = vectorById.get(String(trick._id));
    if (!vector) continue;
    const matches = tricks
      .filter((candidate) => candidate._id !== trick._id && candidate.category === trick.category)
      .map((candidate) => ({
        candidate,
        score: cosine(vector, vectorById.get(String(candidate._id)) || []),
      }))
      .filter((match) => Number.isFinite(match.score) && match.score >= 0.65)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    for (const match of matches) {
      edges.push(
        edge(
          { type: 'Trick', id: String(trick._id), label: trick.name },
          'SIMILAR_TO',
          { type: 'Trick', id: String(match.candidate._id), label: match.candidate.name },
          {
            weight: Number(match.score.toFixed(4)),
            confidence: 'derived',
            evidence: { source: 'atlas_embedding_similarity', sameSport: trick.category },
          },
        ),
      );
    }
  }

  const riderByName = new Map();
  for (const rider of riders) {
    for (const name of [rider.canonicalName, ...(rider.aliases || [])]) {
      riderByName.set(normalizeIdentityPart(name), rider);
    }
  }
  for (const film of films) {
    const filmNode = { type: 'Film', id: String(film._id), label: film.title };
    for (const creditedName of film.riders || []) {
      const rider = riderByName.get(normalizeIdentityPart(creditedName));
      if (!rider) continue;
      edges.push(
        edge(
          filmNode,
          'FEATURES_RIDER',
          { type: 'Rider', id: String(rider._id), label: rider.canonicalName },
          {
            evidenceKey: creditedName,
            evidence: { source: 'couch_videos.riders', creditedName },
          },
        ),
      );
    }
    const searchable = [film.title, film.description, ...(film.tags || [])]
      .filter(Boolean)
      .join(' ');
    for (const trick of tricks) {
      const matchedName = [trick.name, ...(trick.aliases || [])].find((name) =>
        mentions(searchable, name),
      );
      if (!matchedName) continue;
      edges.push(
        edge(
          filmNode,
          'MENTIONS_TRICK',
          { type: 'Trick', id: String(trick._id), label: trick.name },
          {
            evidenceKey: matchedName,
            evidence: { source: 'couch_videos.title_description_tags', matchedName },
          },
        ),
      );
    }
  }

  for (const rider of riders) {
    for (const signature of rider.signatureTricks || []) {
      const name = typeof signature === 'string' ? signature : signature.name;
      const trick = trickByName.get(normalizeIdentityPart(name));
      if (!trick) continue;
      edges.push(
        edge(
          { type: 'Rider', id: String(rider._id), label: rider.canonicalName },
          'KNOWN_FOR_TRICK',
          { type: 'Trick', id: String(trick._id), label: trick.name },
          { evidenceKey: name, evidence: { source: 'riders.signatureTricks', creditedName: name } },
        ),
      );
    }
    for (const credit of rider.couchCredits || []) {
      if (!ObjectId.isValid(String(credit.filmId))) continue;
      edges.push(
        edge(
          { type: 'Rider', id: String(rider._id), label: rider.canonicalName },
          'APPEARS_IN',
          { type: 'Film', id: String(credit.filmId), label: credit.context || '' },
          {
            evidenceKey: String(credit.filmId),
            evidence: { source: 'riders.couchCredits', ...credit },
          },
        ),
      );
    }
  }

  for (const record of history) {
    const trick = trickByName.get(normalizeIdentityPart(record.trickName));
    if (!trick || !record.spotId) continue;
    edges.push(
      edge(
        { type: 'Trick', id: String(trick._id), label: trick.name },
        'PERFORMED_AT',
        { type: 'Spot', id: String(record.spotId), label: '' },
        {
          evidenceKey: String(record._id),
          confidence: record.verified ? 'verified' : 'community',
          evidence: {
            source: 'spot_trick_history',
            recordId: String(record._id),
            skaterName: record.skaterName,
            year: record.year,
            sourceUrl: record.sourceUrl || record.videoUrl,
            verified: Boolean(record.verified),
          },
        },
      ),
    );
  }
  return edges;
}

async function writeEdges(db, edges) {
  const collection = db.collection(EDGE_COLLECTION);
  await Promise.all([
    collection.createIndex({ relation: 1, 'from.type': 1, 'from.id': 1, weight: -1 }),
    collection.createIndex({ relation: 1, 'to.type': 1, 'to.id': 1, confidence: -1 }),
  ]);
  const buildId = new ObjectId().toString();
  for (let offset = 0; offset < edges.length; offset += 500) {
    const batch = edges.slice(offset, offset + 500);
    await collection.bulkWrite(
      batch.map((item) => ({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { ...item, buildId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  const deleted = await collection.deleteMany({ generator: GENERATOR, buildId: { $ne: buildId } });
  return { written: edges.length, deleted: deleted.deletedCount };
}

async function main() {
  if (!process.env.ATLAS_URI) throw new Error('ATLAS_URI environment variable is not set');
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    const edges = await buildEdges(db);
    const result = await writeEdges(db, edges);
    const relations = edges.reduce((counts, item) => {
      counts[item.relation] = (counts[item.relation] || 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({ ...result, relations }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error('[Companion Graph] build failed:', error);
      process.exit(1);
    },
  );
}

module.exports = { buildEdges, cosine, edge, mentions, writeEdges };
