const { pipeline } = require('@xenova/transformers');

const MODEL = process.env.KAORI_EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
let extractorPromise;

function getExtractor() {
  if (!extractorPromise) extractorPromise = pipeline('feature-extraction', MODEL);
  return extractorPromise;
}

async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(String(text), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

module.exports = { DIMENSIONS, MODEL, embed };
