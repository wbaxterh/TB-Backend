const { DBRef, ObjectId } = require('mongodb');

const HEX_24 = /^[0-9a-f]{24}$/i;

// Coerce any id shape this codebase has stored (ObjectId, 24-hex string from a JWT,
// legacy DBRef) to an ObjectId, or null when it is none of those.
function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string') return HEX_24.test(value) ? new ObjectId(value) : null;
  if (value && typeof value === 'object') {
    if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') {
      return new ObjectId(String(value));
    }
    if (value instanceof DBRef) return toObjectId(value.oid);
    if (value.$id !== undefined) return toObjectId(value.$id);
  }
  return null;
}

function idEquals(left, right) {
  const a = toObjectId(left);
  const b = toObjectId(right);
  return Boolean(a && b && a.equals(b));
}

// Query value that matches an id however it was stored. A legacy DBRef only matches
// when it was saved in the two-field form the driver serialises today.
function anyIdShape(value, ref = 'users') {
  const oid = toObjectId(value);
  if (!oid) return null;
  return { $in: [oid, oid.toHexString(), new DBRef(ref, oid)] };
}

module.exports = { toObjectId, idEquals, anyIdShape };
