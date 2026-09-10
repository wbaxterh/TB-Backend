#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');
const { COLLECTION, INDEX } = require('../kaori-rag/kaori-query');
const { DIMENSIONS, MODEL, embed } = require('../kaori-rag/embedding');
const { SOURCES } = require('../kaori-rag/documents');

async function ensureVectorIndex(db, collection) {
  const existing = await collection.aggregate([{ $listSearchIndexes: { name: INDEX } }]).toArray();
  if (existing.length > 0) return existing[0];
  return db.command({
    createSearchIndexes: COLLECTION,
    indexes: [
      {
        name: INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: DIMENSIONS, similarity: 'cosine' },
          ],
        },
      },
    ],
  });
}

async function indexSource(db, target, source) {
  const cursor = db.collection(source.collection).find(source.query);
  let indexed = 0;
  for await (const raw of cursor) {
    const doc = source.transform(raw);
    if (!doc.content.trim()) continue;
    const current = await target.findOne(
      { sourceType: doc.sourceType, sourceId: doc.sourceId },
      { projection: { contentHash: 1, embeddingModel: 1 } },
    );
    if (current?.contentHash === doc.contentHash && current?.embeddingModel === MODEL) continue;
    const vector = await embed(doc.content);
    await target.updateOne(
      { sourceType: doc.sourceType, sourceId: doc.sourceId },
      {
        $set: { ...doc, embedding: vector, embeddingModel: MODEL, indexedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    indexed += 1;
    if (indexed % 25 === 0) console.log(`[Kaori RAG] ${source.sourceType}: ${indexed} indexed`);
  }
  const validIds = await db.collection(source.collection).distinct('_id', source.query);
  const deleted = await target.deleteMany({
    sourceType: source.sourceType,
    sourceId: { $nin: validIds.map(String) },
  });
  return { indexed, deleted: deleted.deletedCount };
}

async function main() {
  if (!process.env.ATLAS_URI) throw new Error('ATLAS_URI environment variable is not set');
  const client = new MongoClient(process.env.ATLAS_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE || 'TrickList2');
    const target = db.collection(COLLECTION);
    await target.createIndex({ sourceType: 1, sourceId: 1 }, { unique: true });
    await ensureVectorIndex(db, target);
    console.log(`[Kaori RAG] indexing with ${MODEL} (${DIMENSIONS} dimensions)`);
    for (const source of SOURCES) {
      const result = await indexSource(db, target, source);
      console.log(`[Kaori RAG] ${source.sourceType}:`, result);
    }
    console.log('[Kaori RAG] complete');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[Kaori RAG] failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { ensureVectorIndex, indexSource };
