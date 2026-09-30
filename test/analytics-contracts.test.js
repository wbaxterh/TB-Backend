const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyVersion,
  compareVersions,
  normalizeEvent,
  sanitizeProperties,
} = require('../services/analyticsContracts');

test('version comparison is numeric rather than lexicographic', () => {
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.3', '3.3.0'), 0);
  assert.equal(compareVersions('2.9.9', '3.0.0'), -1);
});

test('version policy classifies current, optional, and required clients', () => {
  const policy = { latestVersion: '3.3.0', minimumSupportedVersion: '3.1.0' };
  assert.equal(classifyVersion('3.3.0', policy), 'current');
  assert.equal(classifyVersion('3.2.0', policy), 'optional');
  assert.equal(classifyVersion('3.0.9', policy), 'required');
});

test('event normalization trusts authenticated identity and strips sensitive properties', () => {
  const event = normalizeEvent(
    {
      eventId: '0199-test-event',
      name: 'trick_attempt_logged',
      userId: 'spoofed',
      platform: 'ios',
      appVersion: '3.3.0',
      buildNumber: 18,
      properties: { trick_id: 'kickflip', email: 'private@example.com', raw_prompt: 'secret' },
    },
    { userId: 'trusted-user' },
  );
  assert.equal(event.userId, 'trusted-user');
  assert.equal(event.properties.trick_id, 'kickflip');
  assert.equal(event.properties.email, undefined);
  assert.equal(event.properties.raw_prompt, undefined);
});

test('property sanitizer only retains bounded scalar data', () => {
  assert.deepEqual(sanitizeProperties({ ok: true, count: 2, nested: { nope: true } }), {
    ok: true,
    count: 2,
  });
});
