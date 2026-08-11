/**
 * Streamable HTTP transport, stateless mode.
 *
 * SDK 1.30 rules this file exists to demonstrate:
 * - A stateless transport CANNOT be reused across requests (the SDK throws)
 *   — build a fresh McpServer + transport per POST and close both on
 *   response close.
 * - With express.json() the already-consumed body MUST be passed as
 *   handleRequest's 3rd argument or the request hangs.
 * - GET/DELETE /mcp are 405 in stateless mode; the SSE push channel is
 *   optional and Ant's client tolerates its absence.
 * - Clients must send `Accept: application/json, text/event-stream` or the
 *   SDK responds 406 (see scripts/smoke.sh).
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ServerConfig } from './config.js';
import { bearerAuth } from './auth.js';
import { buildServer } from './server.js';
import { log } from './log.js';

export function startHttp(config: ServerConfig): void {
  if (!config.authToken) throw new Error('startHttp requires an auth token');

  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/mcp', bearerAuth(config.authToken), async (req, res) => {
    const server = buildServer({ debugEnvEnabled: config.debugEnvEnabled });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log('request_failed', { err: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'The server failed to handle this MCP request.' });
      }
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response): void => {
    res.status(405).json({
      error: 'Method not allowed — this stateless server only accepts POST /mcp (no SSE push channel).',
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.listen(config.port, () => {
    log('listening', { mode: 'http', port: config.port, debugEnv: config.debugEnvEnabled });
  });
}
