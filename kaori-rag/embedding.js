const { pipeline } = require('@xenova/transformers');

const MODEL = process.env.KAORI_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
let extractorPromise;

function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', MODEL);
  return extractorPromise;
}

async function embed(text) {
  const [vector] = await embedMany([text]);
  return vector;
}

async function embedMany(texts) {
  if (!texts.length) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts.map(String), { pooling: 'mean', normalize: true });
  const flat = Array.from(output.data);
  return texts.map((_, index) => flat.slice(index * DIMENSIONS, (index + 1) * DIMENSIONS));
}

module.exports = { DIMENSIONS, MODEL, embed, embedMany };
