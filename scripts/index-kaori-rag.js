#!/usr/bin/env node
require('dotenv').config();

const { MongoClient } = require('mongodb');
const { COLLECTION, INDEX } = require('../kaori-rag/kaori-query');
const { DIMENSIONS, MODEL, embedMany } = require('../kaori-rag/embedding');
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
  const existing = await target
    .find({ sourceType: source.sourceType })
    .project({ sourceId: 1, contentHash: 1, embeddingModel: 1 })
    .toArray();
  const existingById = new Map(existing.map((doc) => [doc.sourceId, doc]));
  const documents = [];
  const validIds = [];
  const cursor = db.collection(source.collection).find(source.query);
  for await (const raw of cursor) {
    const doc = source.transform(raw);
    validIds.push(doc.sourceId);
    const current = existingById.get(doc.sourceId);
    if (
      doc.content.trim() &&
      (current?.contentHash !== doc.contentHash || current?.embeddingModel !== MODEL)
    ) {
      documents.push(doc);
    }
  }

  let indexed = 0;
  const batchSize = Number(process.env.KAORI_RAG_BATCH_SIZE || 16);
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = documents.slice(offset, offset + batchSize);
    const vectors = await embedMany(batch.map((doc) => doc.content));
    const now = new Date();
    await target.bulkWrite(
      batch.map((doc, index) => ({
        updateOne: {
          filter: { sourceType: doc.sourceType, sourceId: doc.sourceId },
          update: {
            $set: { ...doc, embedding: vectors[index], embeddingModel: MODEL, indexedAt: now },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    indexed += batch.length;
    console.log(`[Kaori RAG] ${source.sourceType}: ${indexed}/${documents.length} indexed`);
  }
  const deleted = await target.deleteMany({
    sourceType: source.sourceType,
    sourceId: { $nin: validIds },
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
