const fs = require('node:fs');
const path = require('node:path');
const { validateDocument } = require('./validate');

const COLLECTIONS_DIR = path.join(__dirname, 'collections');

// Every file in schemas/collections/ exports { [collectionName]: definition }.
// The registry is the single map from collection name to its $jsonSchema.
function loadRegistry(dir = COLLECTIONS_DIR) {
  const registry = {};
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.js'))
        .sort()
    : [];
  for (const file of files) {
    const definitions = require(path.join(dir, file));
    for (const [name, definition] of Object.entries(definitions)) {
      if (registry[name]) {
        throw new Error(`Collection "${name}" is defined twice (${registry[name].file}, ${file})`);
      }
      registry[name] = { ...definition, file };
    }
  }
  return registry;
}

const registry = loadRegistry();

function getSchema(name) {
  return registry[name]?.jsonSchema || null;
}

function validate(name, doc) {
  const schema = getSchema(name);
  if (!schema) throw new Error(`No schema registered for collection "${name}"`);
  return validateDocument(schema, doc);
}

module.exports = {
  registry,
  names: Object.keys(registry).sort(),
  getSchema,
  validate,
  loadRegistry,
};
