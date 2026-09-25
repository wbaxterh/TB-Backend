const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ObjectId } = require('mongodb');
const { names, registry, validate } = require('../schemas');
const { TYPE_CHECKS } = require('../schemas/validate');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'services', 'socket', 'workers', 'mcp', 'store'];
const COLLECTION_CALL = /collection\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
// collection(SOME_CONST) where SOME_CONST = 'name' is declared in the same file.
const COLLECTION_CONST_CALL = /collection\(\s*([A-Z][A-Z0-9_]*)\s*\)/g;

function sourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function collectionsReferencedInCode() {
  const referenced = new Map();
  for (const dir of SOURCE_DIRS) {
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const file of sourceFiles(absolute)) {
      const source = fs.readFileSync(file, 'utf8');
      const names = [...source.matchAll(COLLECTION_CALL)].map((match) => match[1]);
      for (const match of source.matchAll(COLLECTION_CONST_CALL)) {
        const declaration = new RegExp(`const\\s+${match[1]}\\s*=\\s*['"]([A-Za-z0-9_]+)['"]`);
        const declared = source.match(declaration);
        if (declared) names.push(declared[1]);
      }
      for (const name of names) {
        const list = referenced.get(name) || [];
        list.push(path.relative(ROOT, file));
        referenced.set(name, list);
      }
    }
  }
  return referenced;
}

function walk(schema, visit, trail = '') {
  visit(schema, trail);
  for (const [key, child] of Object.entries(schema.properties || {})) {
    walk(child, visit, `${trail}.${key}`);
  }
  if (schema.items) walk(schema.items, visit, `${trail}[]`);
}

const SAMPLE_BY_TYPE = {
  objectId: () => new ObjectId(),
  string: () => 'sample',
  bool: () => true,
  date: () => new Date(),
  null: () => null,
  array: () => [],
  object: () => ({}),
  int: () => 1,
  long: () => 1,
  double: () => 1.5,
  decimal: () => 1,
  number: () => 1,
  binData: () => Buffer.from('x'),
  regex: () => /x/,
  timestamp: () => 1,
};

function sampleFor(fieldSchema) {
  if (fieldSchema.enum) return fieldSchema.enum[0];
  const type = [].concat(fieldSchema.bsonType || 'string')[0];
  if (type === 'string' && fieldSchema.minLength) return 'x'.repeat(fieldSchema.minLength);
  if (type === 'object' && fieldSchema.required) {
    return Object.fromEntries(
      fieldSchema.required.map((key) => [key, sampleFor(fieldSchema.properties?.[key] || {})]),
    );
  }
  if (type === 'array' && fieldSchema.minItems) {
    return Array.from({ length: fieldSchema.minItems }, () => sampleFor(fieldSchema.items || {}));
  }
  return SAMPLE_BY_TYPE[type]();
}

test('every collection the app code touches has a registered schema', () => {
  const referenced = collectionsReferencedInCode();
  const missing = [...referenced.keys()].filter((name) => !registry[name]).sort();
  assert.deepEqual(
    missing,
    [],
    `add these to schemas/collections/: ${missing
      .map((name) => `${name} (${[...new Set(referenced.get(name))].join(', ')})`)
      .join('; ')}`,
  );
});

test('every registered schema is an open object schema with sane metadata', () => {
  assert.ok(names.length > 0, 'registry is empty');
  for (const name of names) {
    const entry = registry[name];
    assert.equal(typeof entry.description, 'string', `${name}: description`);
    assert.ok(Array.isArray(entry.writers), `${name}: writers`);
    for (const writer of entry.writers) {
      assert.ok(fs.existsSync(path.join(ROOT, writer)), `${name}: writer ${writer} does not exist`);
    }
    const schema = entry.jsonSchema;
    assert.equal(schema.bsonType, 'object', `${name}: top-level bsonType`);
    assert.ok(
      schema.properties && Object.keys(schema.properties).length > 0,
      `${name}: properties`,
    );
    assert.notEqual(schema.additionalProperties, false, `${name}: must stay open`);
    for (const key of schema.required || []) {
      assert.ok(key in schema.properties, `${name}: required ${key} is not a property`);
      assert.notEqual(key, '_id', `${name}: _id must not be required`);
    }
  }
});

test('every bsonType named in a schema is one mongod knows', () => {
  for (const name of names) {
    walk(registry[name].jsonSchema, (schema, trail) => {
      for (const type of [].concat(schema.bsonType || [])) {
        assert.ok(TYPE_CHECKS[type], `${name}${trail}: unknown bsonType "${type}"`);
      }
      if (schema.enum)
        assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${name}${trail}: enum`);
    });
  }
});

test('a document built from each schema’s required fields validates', () => {
  for (const name of names) {
    const schema = registry[name].jsonSchema;
    const doc = Object.fromEntries(
      (schema.required || []).map((key) => [key, sampleFor(schema.properties[key])]),
    );
    const result = validate(name, doc);
    assert.deepEqual(result.errors, [], `${name}: ${JSON.stringify(result.errors)}`);
  }
});
