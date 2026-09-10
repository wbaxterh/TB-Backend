const { embed } = require('./embedding');

const COLLECTION = process.env.KAORI_RAG_COLLECTION || 'kaori_knowledge_chunks';
const INDEX = process.env.KAORI_RAG_INDEX || 'kaori_vector_index';
const STOP_WORDS = new Set([
  'about',
  'featuring',
  'from',
  'have',
  'how',
  'that',
  'the',
  'this',
  'what',
  'where',
  'with',
]);

function queryTerms(query) {
  return [
    ...new Set(
      String(query)
        .toLowerCase()
        .match(/[a-z0-9]+/g) || [],
    ),
  ].filter((term) => term.length >= 3 && !STOP_WORDS.has(term));
}

async function keywordSearch(collection, query, limit) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const patterns = terms.map(
    (term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  );
  // Query each term independently so a common word (for example "snowboard")
  // cannot crowd a rider/title name out of the candidate window.
  const batches = await Promise.all(
    patterns.map((pattern) =>
      collection
        .find({ $or: [{ title: pattern }, { content: pattern }] })
        .project({ _id: 0, embedding: 0, contentHash: 0, embeddingModel: 0 })
        .limit(limit)
        .toArray(),
    ),
  );
  const unique = new Map();
  for (const result of batches.flat()) {
    unique.set(`${result.sourceType}:${result.sourceId}`, result);
  }
  return [...unique.values()]
    .map((result) => {
      const haystack = `${result.title || ''} ${result.content || ''}`.toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      return { ...result, score: 1 + matches / terms.length };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function search(db, query, limit = 5) {
  if (!db || !query || process.env.KAORI_RAG_ENABLED === 'false') return [];
  const collection = db.collection(COLLECTION);
  const keywordsPromise = keywordSearch(collection, query, limit);
  const queryVector = await embed(query);
  const vectorResults = await collection
    .aggregate([
      {
        $vectorSearch: {
          index: INDEX,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(50, limit * 10),
          limit,
        },
      },
      {
        $project: {
          _id: 0,
          sourceType: 1,
          sourceId: 1,
          title: 1,
          content: 1,
          webUrl: 1,
          sport: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray();
  const keywords = await keywordsPromise;
  const semantic = vectorResults.filter(
    (result) => result.score >= Number(process.env.KAORI_RAG_MIN_SCORE || 0.35),
  );
  const combined = new Map();
  for (const result of [...keywords, ...semantic]) {
    const key = `${result.sourceType}:${result.sourceId}`;
    if (!combined.has(key)) combined.set(key, result);
  }
  return [...combined.values()].slice(0, limit);
}

module.exports = { COLLECTION, INDEX, queryTerms, search };
