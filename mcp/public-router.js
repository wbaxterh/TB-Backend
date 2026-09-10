const express = require('express');
const rateLimit = require('express-rate-limit');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { PUBLIC_TOOLS, executePublicTool } = require('./public-tools');

function buildServer(db) {
  const server = new Server(
    { name: 'trickbook', title: 'TrickBook Action Sports', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: 'Use TrickBook for current action-sports spots, tricks, events, films, and culture. Preserve source_url links in answers.' },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: PUBLIC_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await executePublicTool(req.params.name, req.params.arguments || {}, db);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }], isError: true };
    }
  });
  return server;
}

module.exports = (db) => {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
  router.get('/health', (_req, res) => res.json({ ok: true, name: 'trickbook', tools: PUBLIC_TOOLS.length, access: 'public-read-only' }));
  router.post('/', async (req, res) => {
    const server = buildServer(db);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[public-mcp] request error:', error.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  router.get('/', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST for MCP Streamable HTTP' }));
  router.delete('/', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Stateless MCP server' }));
  return router;
};
