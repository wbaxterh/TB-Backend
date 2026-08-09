/**
 * Smoke test for trickbook-mcp. Starts nothing — assumes the server is running
 * (npm run mcp). Connects over Streamable HTTP, lists tools, and calls one
 * read-only tool (lookup_boardsport_knowledge — needs no DB/user context).
 *
 *   node mcp/trickbook-mcp.js        # terminal 1
 *   node mcp/smoke-test.js           # terminal 2
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

(async () => {
  const url = new URL(process.env.MCP_URL || 'http://localhost:9101/mcp');
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({ name: 'smoke-test', version: '0.0.1' }, { capabilities: {} });

  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`tools/list (${tools.length}):`, tools.map((t) => t.name).join(', '));

  const res = await client.callTool({
    name: 'lookup_boardsport_knowledge',
    arguments: { sport: 'snowboarding', topic: 'magazines' },
  });
  const text = res.content?.[0]?.text || '';
  console.log('callTool lookup_boardsport_knowledge →', text.slice(0, 200));

  await client.close();
  console.log('SMOKE OK');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message);
  process.exit(1);
});
