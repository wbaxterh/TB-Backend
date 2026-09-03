const assert = require('node:assert/strict');
const test = require('node:test');
const { getAuthProvider, providerMismatch } = require('../services/authProvider');

test('identifies each supported account provider', () => {
  assert.equal(getAuthProvider({ appleUserId: 'apple-id' }), 'apple');
  assert.equal(getAuthProvider({ isGoogleSSO: true }), 'google');
  assert.equal(getAuthProvider({ password: 'hash' }), 'password');
  assert.equal(getAuthProvider({}), null);
});

test('builds an actionable provider mismatch response', () => {
  assert.deepEqual(providerMismatch('google'), {
    error: 'This account uses a different sign-in method.',
    code: 'AUTH_PROVIDER_MISMATCH',
    expectedProvider: 'google',
    recoveryPath: '/forgot-password',
  });
});
