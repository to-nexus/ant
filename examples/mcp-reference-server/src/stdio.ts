/**
 * stdio transport — single client, single long-lived server instance (the
 * per-request factory rule is HTTP-stateless-specific). stdout belongs to
 * the JSON-RPC channel: log.ts is switched to stderr before connecting.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerConfig } from './config.js';
import { buildServer } from './server.js';
import { log, useStderr } from './log.js';

export async function startStdio(config: ServerConfig): Promise<void> {
  useStderr();
  const server = buildServer({ debugEnvEnabled: config.debugEnvEnabled });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('listening', { mode: 'stdio', debugEnv: config.debugEnvEnabled });
}
