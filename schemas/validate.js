const { ObjectId } = require('mongodb');

// App-side evaluator for the $jsonSchema subset used in schemas/collections/*.
// It mirrors what mongod enforces so schemas can be tested without a database
// and so scripts/schema-report.js can validate live documents on a tier where
// the server's warn log is not readable.
const TYPE_CHECKS = {
  objectId: (value) =>
    value instanceof ObjectId ||
    Boolean(
      value &&
        typeof value === 'object' &&
        (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID'),
    ),
  string: (value) => typeof value === 'string',
  bool: (value) => typeof value === 'boolean',
  date: (value) => value instanceof Date && !Number.isNaN(value.getTime()),
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: (value) =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !TYPE_CHECKS.objectId(value),
  int: (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
  long: (value) =>
    Number.isInteger(value) || typeof value === 'bigint' || hasBsonType(value, 'Long'),
  double: (value) => typeof value === 'number' && Number.isFinite(value),
  decimal: (value) => hasBsonType(value, 'Decimal128'),
  number: (value) =>
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'bigint' ||
    hasBsonType(value, 'Long') ||
    hasBsonType(value, 'Int32') ||
    hasBsonType(value, 'Double') ||
    hasBsonType(value, 'Decimal128'),
  binData: (value) => Buffer.isBuffer(value) || hasBsonType(value, 'Binary'),
  regex: (value) => value instanceof RegExp || hasBsonType(value, 'BSONRegExp'),
  timestamp: (value) => hasBsonType(value, 'Timestamp'),
};

function hasBsonType(value, name) {
  return Boolean(value && typeof value === 'object' && value._bsontype === name);
}

function matchesType(value, bsonType) {
  const types = Array.isArray(bsonType) ? bsonType : [bsonType];
  return types.some((type) => {
    const check = TYPE_CHECKS[type];
    if (!check) throw new Error(`Unknown bsonType "${type}"`);
    return check(value);
  });
}

function joinPath(path, key) {
  return path ? `${path}.${key}` : key;
}

function validateString(schema, value, path, errors) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({ path, message: `shorter than ${schema.minLength}` });
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({ path, message: `longer than ${schema.maxLength}` });
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    errors.push({ path, message: `does not match /${schema.pattern}/` });
  }
}

function validateNumber(schema, value, path, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ path, message: `below minimum ${schema.minimum}` });
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({ path, message: `above maximum ${schema.maximum}` });
  }
}

function validateArray(schema, value, path, errors) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({ path, message: `fewer than ${schema.minItems} items` });
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({ path, message: `more than ${schema.maxItems} items` });
  }
  if (!schema.items) return;
  for (const [index, item] of value.entries()) {
    validateValue(schema.items, item, `${path}[${index}]`, errors);
  }
}

function hasObjectRules(schema) {
  return Boolean(schema.properties || schema.required || schema.additionalProperties === false);
}

function validateValue(schema, value, path, errors) {
  if (schema.bsonType && !matchesType(value, schema.bsonType)) {
    errors.push({ path, message: `expected ${[].concat(schema.bsonType).join('|')}` });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
    return;
  }
  if (typeof value === 'string') validateString(schema, value, path, errors);
  if (typeof value === 'number') validateNumber(schema, value, path, errors);
  if (Array.isArray(value)) validateArray(schema, value, path, errors);
  if (TYPE_CHECKS.object(value) && hasObjectRules(schema)) {
    validateObject(schema, value, path, errors);
  }
}

function validateObject(schema, doc, path, errors) {
  for (const key of schema.required || []) {
    if (doc[key] === undefined) errors.push({ path: joinPath(path, key), message: 'required' });
  }
  for (const [key, subSchema] of Object.entries(schema.properties || {})) {
    if (doc[key] === undefined) continue;
    validateValue(subSchema, doc[key], joinPath(path, key), errors);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(doc)) {
      if (!schema.properties || !(key in schema.properties)) {
        errors.push({ path: joinPath(path, key), message: 'not allowed' });
      }
    }
  }
}

function validateDocument(jsonSchema, doc) {
  const errors = [];
  validateValue(jsonSchema, doc, '', errors);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateDocument, matchesType, TYPE_CHECKS };
