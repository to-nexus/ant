/**
 * MCP configuration/connect failure — the typed boundary between "the user's
 * agent definition or credentials are wrong" and "the platform crashed".
 *
 * Thrown by credential resolution (unregistered key) and wrapped around every
 * `McpConnectionManager.connect()` failure (unreachable server, timeout,
 * handshake error). `job-runner.ts` maps it to the `config_invalid`
 * interruption reason (non-infrastructure, canResume:false) so classification
 * never depends on message-string sniffing. Duck-typed like `LlmAuthError`
 * because errors cross the job-runner child-process boundary.
 */
export class McpConfigError extends Error {
  readonly isMcpConfigError = true;
  /** Server whose config/connect failed, when known. */
  readonly serverName?: string;
  readonly cause?: unknown;
  constructor(message: string, options?: { serverName?: string; cause?: unknown }) {
    super(message);
    this.name = 'McpConfigError';
    this.serverName = options?.serverName;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export function isMcpConfigError(error: unknown): error is McpConfigError {
  if (!error || typeof error !== 'object') return false;
  const e = error as any;
  return e instanceof McpConfigError || e.isMcpConfigError === true;
}
