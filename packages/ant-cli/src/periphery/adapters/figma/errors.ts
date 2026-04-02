/**
 * Figma adapter error classes.
 *
 * Follows the same pattern as GitService/errors.ts — domain-specific errors
 * in the periphery adapter layer, importable by both graph nodes and
 * infrastructure (TaskOrchestrator) without architectural violations.
 */

export class FigmaRateLimitError extends Error {
  constructor(message = 'Figma API rate limit exceeded') {
    super(message);
    this.name = 'FigmaRateLimitError';
  }
}

/**
 * Predicate matching the TaskOrchestrator error-classification pattern
 * (isDeterministicError, isTimeoutError, isRecursionLimitError).
 * Checks both instanceof and message pattern for robustness across
 * serialization boundaries.
 */
export function isFigmaRateLimitError(error: Error): boolean {
  return error instanceof FigmaRateLimitError
    || /figma.*rate limit/i.test(error.message);
}

export class FigmaMCPConnectionError extends Error {
  constructor(message = 'Figma MCP connection lost') {
    super(message);
    this.name = 'FigmaMCPConnectionError';
  }
}

export function isFigmaMCPConnectionError(error: Error): boolean {
  return error instanceof FigmaMCPConnectionError
    || /figma.*connection lost/i.test(error.message);
}

/**
 * Detect Figma API rate-limit from MCP response content.
 * Figma MCP Bridge returns rate-limit responses with isError: false,
 * so this must be checked on the extracted text regardless of the isError flag.
 */
export function isRateLimitResponse(content: string): boolean {
  return /rate limit/i.test(content);
}

/**
 * Categorises a Figma MCP error so callers can decide whether the failure
 * is infrastructure-level (worth counting toward "connection lost") or
 * request-level (should fail the individual task only).
 *
 *  - connection   : network / transport / MCP server unreachable / timeout
 *  - environment  : Figma Desktop state (no window, no file, plugin off)
 *  - data         : per-request issue (node not found, invalid args, Figma internal)
 *  - rate_limit   : API rate limit (already handled separately in most call-sites)
 */
export type FigmaErrorCategory = 'connection' | 'environment' | 'data' | 'rate_limit';

export function classifyFigmaError(error: Error | string): FigmaErrorCategory {
  const msg = typeof error === 'string' ? error : error.message;

  if (/rate limit/i.test(msg)) return 'rate_limit';

  // connection: network / transport failures
  if (/timed?\s*out|timeout/i.test(msg)) return 'connection';
  if (/econnrefused|econnreset|enotfound|enetunreach|socket hang up/i.test(msg)) return 'connection';
  if (/mcp initialize/i.test(msg)) return 'connection';
  if (/^http [45]\d\d/i.test(msg)) return 'connection';
  if (/bridge mcp request timed out/i.test(msg)) return 'connection';
  if (/mcp transport error/i.test(msg)) return 'connection';

  // environment: Figma Desktop state issues
  const lower = msg.toLowerCase();
  const SOFT_PATTERNS = ['no figma window open', 'no file open', 'plugin not running', 'only available if your active tab'];
  if (SOFT_PATTERNS.some(p => lower.includes(p))) return 'environment';
  if (/figma desktop is not accessible/i.test(msg)) return 'environment';

  return 'data';
}
