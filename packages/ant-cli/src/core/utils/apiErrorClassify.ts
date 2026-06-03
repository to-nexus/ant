/**
 * Post-retry API error classification.
 *
 * By the time an LLM error survives `withRetry` (8 attempts × backoff) and the
 * orchestrator's MAX_TASK_RETRIES re-queue, it reaches the failure-aggregation
 * layer as a plain `Error` whose `.message` is the *stringified* Anthropic
 * payload (e.g. `{"type":"error","error":{"type":"overloaded_error",...}}`).
 * The structured object is gone, so classification here matches the message
 * string — same vocabulary as retry.ts's `isRetryableError`, kept narrow so an
 * external capacity outage is distinguishable from a genuine code defect.
 */

/**
 * True when the failure is an Anthropic server-side capacity error
 * (HTTP 529 `overloaded_error`) — external and transient, NOT caused by the
 * generated code. Distinct from `rate_limit_error` (429, our request volume).
 */
export function isOverloadedError(error: { message?: string } | string | null | undefined): boolean {
  const msg = (typeof error === 'string' ? error : error?.message) || '';
  return (
    /overloaded_error/i.test(msg) ||
    /"message"\s*:\s*"overloaded"/i.test(msg) ||
    /\b529\b/.test(msg)
  );
}

/**
 * Collapse a raw Anthropic error message into a short, user-readable cause.
 * Keeps raw JSON out of the choice card. Falls back to the trimmed message.
 */
export function summarizeFailureCause(errorMessage: string | undefined): string {
  const msg = errorMessage || '';
  if (isOverloadedError(msg)) return 'Anthropic API overloaded';
  if (/rate_limit_error/i.test(msg)) return 'API rate limit reached';
  if (/recursion limit/i.test(msg)) return 'Recursion limit reached';
  if (/prompt is too long/i.test(msg)) return 'Prompt too long';

  // Try to lift Anthropic's nested `error.message` out of a JSON payload.
  const inner = msg.match(/"message"\s*:\s*"([^"]{1,120})"/);
  if (inner) return inner[1];

  const trimmed = msg.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}
