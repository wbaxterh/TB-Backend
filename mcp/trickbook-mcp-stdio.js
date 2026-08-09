/**
 * stdio entrypoint for trickbook-mcp — for clients that SPAWN the server and
 * talk over stdin/stdout (Claude Desktop, MCP Inspector). Same 8 tools as the
 * HTTP server (trickbook-mcp.js); user context is a single fixed user from
 * MCP_DEV_USER_ID (set it in the client config to exercise the user-scoped
 * tools like get_user_tricklists).
 *
 * NOTE: on stdio, stdout is the JSON-RPC channel — nothing else may write to
 * it. We route all console.log (incl. db.js's connect message) to stderr.
 */
console.log = (...args) => console.error(...args); // keep stdout clean for MCP

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { connectToDatabase } = require('../db');
const { TOOL_DEFINITIONS, executeToolCall } = require('../kaori-tools');

const MCP_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  inputSchema:
    t.function.parameters && typeof t.function.parameters === 'object'
      ? t.function.parameters
      : { type: 'object', properties: {} },
}));

async function main() {
  const db = await connectToDatabase();
  const senderId = process.env.MCP_DEV_USER_ID || '';

  const server = new Server(
    { name: 'trickbook-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const result = await executeToolCall(name, args || {}, db, senderId);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error(`[trickbook-mcp stdio] ready — ${MCP_TOOLS.length} tools`);
}

main().catch((err) => {
  console.error('[trickbook-mcp stdio] fatal:', err);
  process.exit(1);
});
