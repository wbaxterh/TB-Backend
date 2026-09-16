const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_TOOLS, executePublicTool } = require('../mcp/public-tools');

test('public MCP exposes only read-only tools', () => {
  const names = PUBLIC_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, [
    'search_spots',
    'search_trickipedia',
    'search_films',
    'lookup_boardsport_knowledge',
    'get_spot',
    'get_trick',
    'search_events',
    'get_event',
  ]);
  for (const tool of PUBLIC_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('public MCP rejects private and write tools', async () => {
  await assert.rejects(
    () => executePublicTool('get_user_tricklists', {}, {}),
    /Unknown or unavailable public tool/,
  );
  await assert.rejects(
    () => executePublicTool('create_tricklist', { title: 'Secret' }, {}),
    /Unknown or unavailable public tool/,
  );
});
