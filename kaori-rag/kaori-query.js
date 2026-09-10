const { embed } = require('./embedding');

const COLLECTION = process.env.KAORI_RAG_COLLECTION || 'kaori_knowledge_chunks';
const INDEX = process.env.KAORI_RAG_INDEX || 'kaori_vector_index';

async function search(db, query, limit = 5) {
  if (!db || !query || process.env.KAORI_RAG_ENABLED === 'false') return [];
  const queryVector = await embed(query);
  const results = await db
    .collection(COLLECTION)
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
  return results.filter(
    (result) => result.score >= Number(process.env.KAORI_RAG_MIN_SCORE || 0.35),
  );
}

module.exports = { COLLECTION, INDEX, search };
