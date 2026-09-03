const assert = require('node:assert/strict');
const test = require('node:test');

test('riders route exports a router factory', () => {
  const createRidersRouter = require('../routes/riders');
  assert.equal(typeof createRidersRouter, 'function');
});
