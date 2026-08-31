const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const path = require('node:path');

test('the server entrypoint parses successfully', () => {
  const entrypoint = path.join(__dirname, '..', 'index.js');
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', entrypoint]));
});
