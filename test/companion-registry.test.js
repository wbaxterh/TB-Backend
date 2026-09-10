const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSystemPrompt } = require('../kaori-ai-response');
const { getCompanion, hasCompanion, listCompanions, register } = require('../companion-registry');

test('Kaori is registered with production identity metadata', () => {
  assert.equal(hasCompanion('kaori'), true);
  assert.equal(getCompanion('kaori').botId, '69c15e55c7ebe2c6884f1267');
});

test('new companion configs register without response-engine code changes', () => {
  register('test-coach', {
    displayName: 'Test Coach',
    intro: 'You are a test coach.',
    messageExamples: [{ user: 'Hi', assistant: 'Ready.' }],
  });
  assert.equal(hasCompanion('test-coach'), true);
  assert.match(buildSystemPrompt(getCompanion('test-coach')), /Ready\./);
  assert.ok(listCompanions().some((item) => item.id === 'test-coach'));
});
