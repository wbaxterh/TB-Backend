const crypto = require('node:crypto');

const ALLOWED_PLATFORMS = new Set(['web', 'ios', 'android']);
const SENSITIVE_KEYS =
  /(^|_)(email|password|token|authorization|prompt|message|latitude|longitude|receipt)($|_)/i;
const MAX_PROPERTIES_BYTES = 16 * 1024;

function isScalar(value) {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function safeString(value, maxLength = 256) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function sanitizeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, property] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || SENSITIVE_KEYS.test(key)) continue;
    if (isScalar(property)) {
      clean[key] = property;
    } else if (typeof property === 'string') {
      clean[key] = property.slice(0, 512);
    } else if (
      Array.isArray(property) &&
      property.length <= 20 &&
      property.every((item) => typeof item === 'string' || typeof item === 'number')
    ) {
      clean[key] = property;
    }
  }
  return Buffer.byteLength(JSON.stringify(clean)) <= MAX_PROPERTIES_BYTES ? clean : {};
}

function eventDate(input) {
  const occurredAt = new Date(input.occurredAt || input.timestamp || Date.now());
  const now = new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error('invalid occurredAt');
  if (occurredAt.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new Error('occurredAt is too far in the future');
  }
  return { now, occurredAt };
}

function normalizeEvent(input, context = {}) {
  if (!input || typeof input !== 'object') throw new Error('event must be an object');
  const name = safeString(input.name || input.event, 80);
  if (!name || !/^[a-z$][a-z0-9_$.-]{1,79}$/i.test(name)) {
    throw new Error('invalid event name');
  }

  const eventId = safeString(input.eventId, 128) || crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(eventId)) throw new Error('invalid eventId');
  const { now, occurredAt } = eventDate(input);

  const platform = ALLOWED_PLATFORMS.has(input.platform)
    ? input.platform
    : context.platform || 'web';
  return {
    eventId,
    event: name,
    name,
    schemaVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : 1,
    occurredAt,
    receivedAt: now,
    timestamp: occurredAt,
    anonymousId: safeString(input.anonymousId, 128),
    installationId: safeString(input.installationId, 128),
    sessionId: safeString(input.sessionId, 128),
    userId: context.userId || null,
    platform,
    appVersion: safeString(input.appVersion, 32),
    buildNumber: safeString(String(input.buildNumber || ''), 32),
    source: sanitizeProperties(input.source),
    properties: sanitizeProperties(input.properties),
    url: safeString(input.url, 2048),
    referrer: safeString(input.referrer, 2048),
    userAgent: safeString(input.userAgent || context.userAgent, 512),
  };
}

function compareVersions(left, right) {
  const a = String(left || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function classifyVersion(version, policy) {
  if (compareVersions(version, policy.minimumSupportedVersion) < 0) return 'required';
  if (compareVersions(version, policy.latestVersion) < 0) return 'optional';
  return 'current';
}

module.exports = { classifyVersion, compareVersions, normalizeEvent, sanitizeProperties };
