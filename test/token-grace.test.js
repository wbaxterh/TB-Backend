const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { verifyTokenWithGrace } = require('../middleware/auth');

const DAY = 24 * 60 * 60;

function tokenExpiredDaysAgo(days, payload = { userId: 'u1' }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { ...payload, iat: now - 60 * DAY, exp: now - days * DAY },
    process.env.JWT_SECRET,
  );
}

test('accepts a live token', () => {
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal(verifyTokenWithGrace(token).userId, 'u1');
});

test('accepts a token expired within the 30-day grace window', () => {
  const payload = verifyTokenWithGrace(tokenExpiredDaysAgo(10));
  assert.equal(payload.userId, 'u1');
});

test('rejects a token expired beyond the grace window', () => {
  assert.equal(verifyTokenWithGrace(tokenExpiredDaysAgo(40)), null);
});

test('rejects garbage, wrong-secret, and missing tokens', () => {
  assert.equal(verifyTokenWithGrace('not-a-token'), null);
  assert.equal(verifyTokenWithGrace(jwt.sign({ userId: 'u1' }, 'other-secret')), null);
  assert.equal(verifyTokenWithGrace(undefined), null);
  assert.equal(verifyTokenWithGrace(null), null);
});
