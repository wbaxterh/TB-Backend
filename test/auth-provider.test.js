const assert = require('node:assert/strict');
const test = require('node:test');
const { getAuthProvider, providerMismatch } = require('../services/authProvider');

test('identifies each supported account provider', () => {
  assert.equal(getAuthProvider({ appleUserId: 'apple-id' }), 'apple');
  assert.equal(getAuthProvider({ isGoogleSSO: true }), 'google');
  assert.equal(getAuthProvider({ password: 'hash' }), 'password');
  assert.equal(getAuthProvider({}), null);
});

test('a linked SSO↔SSO account is not treated as a mismatch by its own providers', () => {
  // After Apple↔Google linking, an account carries BOTH identity fields.
  // getAuthProvider resolves to a single provider (apple first), but the
  // route handlers gate on the specific field (user.isGoogleSSO /
  // user.appleUserId), so both SSO logins succeed on a linked account.
  const linked = { appleUserId: 'apple-id', isGoogleSSO: true };
  assert.equal(getAuthProvider(linked), 'apple');
  assert.equal(Boolean(linked.isGoogleSSO), true);
  assert.equal(Boolean(linked.appleUserId), true);
});

test('builds an actionable provider mismatch response', () => {
  assert.deepEqual(providerMismatch('google'), {
    error: 'This account uses a different sign-in method.',
    code: 'AUTH_PROVIDER_MISMATCH',
    expectedProvider: 'google',
    recoveryPath: '/forgot-password',
  });
});
