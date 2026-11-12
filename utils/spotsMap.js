const MAP_PIN_LIMIT = 2000;
const MAP_CLUSTER_LIMIT = 500;
const CLUSTER_MAX_ZOOM = 7;

function numberParam(value, name, min, max) {
  const scalar = typeof value === 'string' && value.trim() !== '';
  const parsed = scalar ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const error = new Error(`Invalid ${name}`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function parseMapRequest(query) {
  const required = ['minLat', 'maxLat', 'minLng', 'maxLng'];
  const supplied = required.filter((key) => query[key] !== undefined);
  if (supplied.length !== 0 && supplied.length !== required.length) {
    const error = new Error('All bounding box parameters are required');
    error.status = 400;
    throw error;
  }

  const bounds = supplied.length
    ? {
        minLat: numberParam(query.minLat, 'minLat', -90, 90),
        maxLat: numberParam(query.maxLat, 'maxLat', -90, 90),
        minLng: numberParam(query.minLng, 'minLng', -180, 180),
        maxLng: numberParam(query.maxLng, 'maxLng', -180, 180),
      }
    : null;

  if (bounds && bounds.minLat > bounds.maxLat) {
    const error = new Error('minLat must be less than or equal to maxLat');
    error.status = 400;
    throw error;
  }

  const zoom = query.zoom === undefined ? 12 : numberParam(query.zoom, 'zoom', 0, 22);
  return {
    bounds,
    zoom,
    aggregate: query.aggregate !== 'false' && zoom <= CLUSTER_MAX_ZOOM,
    version: query.v === '2' ? 2 : 1,
  };
}

function longitudeCondition(minLng, maxLng) {
  if (minLng <= maxLng) return { longitude: { $gte: minLng, $lte: maxLng } };
  return { $or: [{ longitude: { $gte: minLng } }, { longitude: { $lte: maxLng } }] };
}

function clusterCellSize(zoom) {
  return Math.max(0.25, 360 / 2 ** (Math.floor(zoom) + 2));
}

module.exports = {
  CLUSTER_MAX_ZOOM,
  MAP_CLUSTER_LIMIT,
  MAP_PIN_LIMIT,
  clusterCellSize,
  longitudeCondition,
  parseMapRequest,
};
