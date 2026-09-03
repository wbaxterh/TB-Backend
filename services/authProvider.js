const PROVIDERS = Object.freeze({
  APPLE: 'apple',
  GOOGLE: 'google',
  PASSWORD: 'password',
});

function getAuthProvider(user) {
  if (user?.appleUserId) return PROVIDERS.APPLE;
  if (user?.isGoogleSSO) return PROVIDERS.GOOGLE;
  if (user?.password) return PROVIDERS.PASSWORD;
  return null;
}

function providerMismatch(provider) {
  return {
    error: 'This account uses a different sign-in method.',
    code: 'AUTH_PROVIDER_MISMATCH',
    expectedProvider: provider,
    recoveryPath: '/forgot-password',
  };
}

module.exports = { PROVIDERS, getAuthProvider, providerMismatch };
