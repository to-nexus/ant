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

/**
 * Detect Figma API rate-limit from MCP response content.
 * Figma MCP Bridge returns rate-limit responses with isError: false,
 * so this must be checked on the extracted text regardless of the isError flag.
 */
export function isRateLimitResponse(content: string): boolean {
  return /rate limit/i.test(content);
}
