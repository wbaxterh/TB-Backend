function getDbRefId(ref) {
  return ref?.oid ?? ref?.$id ?? null;
}

module.exports = getDbRefId;
