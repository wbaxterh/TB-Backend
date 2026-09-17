const assert = require('node:assert/strict');
const test = require('node:test');

const { DBRef, ObjectId } = require('mongodb');
const getDbRefId = require('../utils/dbRefId');

test('reads the owner id from a hydrated MongoDB DBRef', () => {
  const ownerId = new ObjectId();
  const ref = new DBRef('users', ownerId);

  assert.equal(String(getDbRefId(ref)), String(ownerId));
});

test('reads legacy/plain DBRef shapes', () => {
  const ownerId = new ObjectId();

  assert.equal(String(getDbRefId({ $id: ownerId })), String(ownerId));
  assert.equal(getDbRefId(null), null);
});
