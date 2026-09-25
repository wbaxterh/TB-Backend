const assert = require('node:assert/strict');
const test = require('node:test');
const { DBRef, ObjectId } = require('mongodb');
const { validateDocument } = require('../schemas/validate');

const schema = {
  bsonType: 'object',
  required: ['email', 'createdAt'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: { bsonType: 'string', minLength: 3 },
    userId: { bsonType: ['objectId', 'string', 'object'] },
    role: { enum: ['admin', 'moderator', null] },
    createdAt: { bsonType: 'date' },
    updatedAt: { bsonType: 'number' },
    homieRequests: {
      bsonType: 'object',
      properties: {
        sent: { bsonType: 'array', items: { bsonType: 'objectId' } },
        received: { bsonType: 'array' },
      },
    },
    sports: { bsonType: 'array', items: { enum: ['skate', 'snow', 'wake'] }, maxItems: 3 },
    strict: {
      bsonType: 'object',
      properties: { a: { bsonType: 'int' } },
      additionalProperties: false,
    },
  },
};

test('accepts a document that matches', () => {
  const result = validateDocument(schema, {
    _id: new ObjectId(),
    email: 'rider@example.com',
    userId: new DBRef('users', new ObjectId()),
    role: null,
    createdAt: new Date(),
    updatedAt: Date.now(),
    homieRequests: { sent: [new ObjectId()], received: [] },
    sports: ['skate'],
    extraLegacyField: 'still allowed',
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('reports missing required fields and wrong types with paths', () => {
  const { valid, errors } = validateDocument(schema, {
    email: 42,
    createdAt: '2026-01-01',
    homieRequests: { sent: ['not-an-object-id'] },
  });
  assert.equal(valid, false);
  assert.deepEqual(
    errors.map((error) => `${error.path}: ${error.message}`),
    [
      'email: expected string',
      'createdAt: expected date',
      'homieRequests.sent[0]: expected objectId',
    ],
  );
});

test('a required field present as null still counts as present', () => {
  const { errors } = validateDocument(
    { bsonType: 'object', required: ['role'], properties: { role: { enum: [null, 'admin'] } } },
    { role: null },
  );
  assert.deepEqual(errors, []);
});

test('enforces enums, array bounds and closed objects', () => {
  const { errors } = validateDocument(schema, {
    email: 'ok@example.com',
    createdAt: new Date(),
    role: 'god',
    sports: ['skate', 'surf', 'snow', 'wake'],
    strict: { a: 1.5, b: 2 },
  });
  assert.deepEqual(
    errors.map((error) => error.path),
    ['role', 'sports', 'sports[1]', 'strict.a', 'strict.b'],
  );
});

test('mixed types accept any listed shape and reject the rest', () => {
  const idSchema = {
    bsonType: 'object',
    properties: { userId: { bsonType: ['objectId', 'string'] } },
  };
  assert.equal(validateDocument(idSchema, { userId: new ObjectId() }).valid, true);
  assert.equal(validateDocument(idSchema, { userId: 'abc' }).valid, true);
  assert.equal(validateDocument(idSchema, { userId: 7 }).valid, false);
});

test('an unknown bsonType is a schema bug, not a silent pass', () => {
  assert.throws(
    () =>
      validateDocument({ bsonType: 'object', properties: { x: { bsonType: 'text' } } }, { x: 1 }),
    /Unknown bsonType "text"/,
  );
});
