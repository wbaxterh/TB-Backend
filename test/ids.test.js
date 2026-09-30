const assert = require('node:assert/strict');
const test = require('node:test');
const { DBRef, ObjectId } = require('mongodb');
const { anyIdShape, idEquals, toObjectId } = require('../utils/ids');

const oid = new ObjectId();

test('coerces every id shape the database holds to an ObjectId', () => {
  assert.equal(toObjectId(oid), oid);
  assert.ok(toObjectId(oid.toHexString()).equals(oid));
  assert.ok(toObjectId(new DBRef('users', oid)).equals(oid));
  assert.ok(toObjectId({ $ref: 'users', $id: oid }).equals(oid));
  assert.ok(toObjectId({ $id: oid.toHexString() }).equals(oid));
});

test('refuses values that are not ids', () => {
  assert.equal(toObjectId('not-an-id'), null);
  assert.equal(toObjectId('rider@example.com'), null);
  assert.equal(toObjectId(12345), null);
  assert.equal(toObjectId(null), null);
  assert.equal(toObjectId(undefined), null);
  assert.equal(toObjectId({}), null);
});

test('compares ids across shapes', () => {
  assert.equal(idEquals(oid, oid.toHexString()), true);
  assert.equal(idEquals(new DBRef('users', oid), oid), true);
  assert.equal(idEquals(oid, new ObjectId()), false);
  assert.equal(idEquals(oid, 'garbage'), false);
});

test('builds a filter that matches ObjectId, hex string and legacy DBRef storage', () => {
  const filter = anyIdShape(oid.toHexString());
  assert.equal(filter.$in.length, 3);
  assert.ok(filter.$in[0].equals(oid));
  assert.equal(filter.$in[1], oid.toHexString());
  assert.ok(filter.$in[2] instanceof DBRef);
  assert.equal(filter.$in[2].collection, 'users');
  assert.equal(anyIdShape('nope'), null);
});
