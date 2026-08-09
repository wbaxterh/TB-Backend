/**
 * trickbook-mcp — Model Context Protocol server for TrickBook's agent tools.
 *
 * Wraps the same tool definitions + handlers Kaori's brain already uses
 * (kaori-tools.js) and exposes them over MCP so ANY brain/client can consume
 * them: the current OpenRouter loop, a future LangGraph/Mastra service, Claude
 * Desktop, an MCP Inspector, etc. Single source of truth for the tools — no
 * duplicated schema mapping.
 *
 * Transport: Streamable HTTP in STATELESS mode (a fresh Server + transport per
 * request, no session id) — this sidesteps the stateful-session vs
 * load-balancer scaling gap called out in the 2026 MCP roadmap.
 *
 * User context: MCP tools that touch a specific user's data (tricklists,
 * remember_user_info) need a senderId. It is read per request from the
 * `x-trickbook-user-id` header. For local dev you can set MCP_DEV_USER_ID.
 * (This server is meant to run inside the trusted backend network, same trust
 * boundary as the brain — it does not itself authenticate the header.)
 *
 * Run:  node mcp/trickbook-mcp.js   (or: npm run mcp)
 */

require('dotenv').config();
const express = require('express');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { connectToDatabase } = require('../db');
const { TOOL_DEFINITIONS, executeToolCall } = require('../kaori-tools');

const PORT = process.env.MCP_PORT || 9101;

// Map our OpenAI-format tool defs → MCP tool descriptors (their JSON-schema
// `parameters` is already a valid MCP inputSchema).
const MCP_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  inputSchema:
    t.function.parameters && typeof t.function.parameters === 'object'
      ? t.function.parameters
      : { type: 'object', properties: {} },
}));

// Build a fresh MCP Server bound to one request's user context.
function buildServer(db, senderId) {
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

  return server;
}

async function main() {
  const db = await connectToDatabase();
  console.log(`[trickbook-mcp] Mongo connected; ${MCP_TOOLS.length} tools registered`);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, tools: MCP_TOOLS.length }));

  // Stateless Streamable HTTP: one Server + transport per POST, torn down after.
  app.post('/mcp', async (req, res) => {
    const senderId = req.header('x-trickbook-user-id') || process.env.MCP_DEV_USER_ID || '';
    const server = buildServer(db, senderId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[trickbook-mcp] request error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless server has no long-lived sessions — reject the SSE/terminate verbs.
  const methodNotAllowed = (_req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless server)' },
      id: null,
    });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.listen(PORT, () => {
    console.log(`[trickbook-mcp] listening on http://localhost:${PORT}/mcp`);
  });
}

main().catch((err) => {
  console.error('[trickbook-mcp] fatal:', err);
  process.exit(1);
});
