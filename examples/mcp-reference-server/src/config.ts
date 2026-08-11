/** Default HTTP port. The single source — .env.example, scripts/smoke.sh and
 *  the job.yaml url in ../custom-agents/ops-team all mirror this number. */
export const DEFAULT_PORT = 8931;

export interface ServerConfig {
  mode: 'http' | 'stdio';
  port: number;
  authToken: string | undefined;
  debugEnvEnabled: boolean;
}

export function loadConfig(argv: string[]): ServerConfig {
  const mode = argv.includes('--stdio') ? 'stdio' : 'http';
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer (got: ${process.env.PORT})`);
  }
  const authToken = process.env.MCP_AUTH_TOKEN || undefined;
  if (mode === 'http' && !authToken) {
    throw new Error(
      'MCP_AUTH_TOKEN is required in HTTP mode — refusing to start an unauthenticated server. ' +
        'Copy .env.example to .env and set a token.',
    );
  }
  return {
    mode,
    port,
    authToken,
    debugEnvEnabled: process.env.SKELETON_DEBUG_ENV === '1',
  };
}
