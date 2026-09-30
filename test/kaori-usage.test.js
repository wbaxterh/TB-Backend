const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIMITS,
  getDeviceKey,
  minuteKey,
  monthKey,
  nextUtcDay,
  nextUtcMonth,
  utcDayKey,
} = require('../services/kaoriUsage');

test('Kaori allowance tiers are bounded and premium is larger than free', () => {
  assert.equal(LIMITS.free.textDaily, 20);
  assert.equal(LIMITS.premium.textDaily, 250);
  assert.ok(LIMITS.premium.textDaily > LIMITS.free.textDaily);
  assert.ok(LIMITS.free.accountPerMinute < LIMITS.free.devicePerMinute);
  assert.equal(LIMITS.free.voiceLimit, 5);
  assert.equal(LIMITS.premium.voiceLimit, 200);
});

test('usage keys and reset use UTC boundaries', () => {
  const date = new Date('2026-09-30T23:59:45.000Z');
  assert.equal(utcDayKey(date), '2026-09-30');
  assert.equal(minuteKey(date), '2026-09-30T23:59');
  assert.equal(nextUtcDay(date).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(monthKey(date), '2026-09');
  assert.equal(nextUtcMonth(date).toISOString(), '2026-10-01T00:00:00.000Z');
});

test('device abuse key is stable and does not retain the raw identifier', () => {
  const req = {
    header(name) {
      return name === 'x-trickbook-device-id' ? 'device_1234567890abcdef' : '';
    },
    ip: '203.0.113.7',
  };
  const first = getDeviceKey(req);
  const second = getDeviceKey(req);
  assert.equal(first, second);
  assert.equal(first.length, 24);
  assert.ok(!first.includes('device_1234567890abcdef'));
});

test('invalid device identifiers fall back to a privacy-preserving IP hash', () => {
  const makeReq = (device) => ({
    header: () => device,
    ip: '203.0.113.9',
  });
  assert.equal(getDeviceKey(makeReq('short')), getDeviceKey(makeReq('also bad')));
});
