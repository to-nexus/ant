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
 * Provider account balance / quota depletion signatures.
 *
 * Some OpenAI-compatible providers (notably GLM/Zhipu) multiplex two orthogonal
 * conditions onto HTTP 429: transient rate-limit/overload (retryable) AND a hard
 * account-balance / resource-package depletion, where retrying NEVER succeeds —
 * only an operator recharge clears it. The status code alone cannot distinguish
 * them, so message-substring matching is the only available signal. This is a
 * deliberate provider-message coupling, permitted here precisely because no
 * version-independent (status/header) signal exists.
 */
const BALANCE_DEPLETION_SIGNATURES = [
  'insufficient balance',
  'balance is insufficient',
  'no resource package',
  'recharge',
  'insufficient_quota',
  'arrearage',
];

/**
 * True when the error signals a hard upstream-provider account balance/quota
 * depletion (NOT the user's own credit balance). NON-retryable and NOT a code
 * defect: the shared provider account is out of funds. SSOT for both the retry
 * classifier (`retry.ts`) and the user-facing interruption-message normalization
 * (`classifyOrchestratorFailure`). Accepts a raw error object (with nested
 * `.error.message`), a string, or a message-bearing shape.
 */
export function isProviderBalanceDepletion(
  error: { message?: string } | string | null | undefined | unknown,
): boolean {
  let msg = '';
  if (typeof error === 'string') {
    msg = error;
  } else if (error && typeof error === 'object') {
    const e = error as any;
    msg = [e.message, e.error?.message, e.error?.error?.message]
      .filter((m): m is string => typeof m === 'string')
      .join(' ');
  }
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return BALANCE_DEPLETION_SIGNATURES.some((sig) => lower.includes(sig));
}

/**
 * True when the failure is a deterministic "request too large" error — the
 * assembled prompt exceeded the model's context window (Anthropic 400
 * `invalid_request_error`, "prompt is too long"). This is NOT transient and NOT
 * resumable: retrying/resuming re-sends the same oversized request. The request
 * itself is ill-formed (too many / too large references selected), so the job
 * must fail explicitly and the user must narrow the request.
 */
export function isPromptTooLongError(error: { message?: string } | string | null | undefined): boolean {
  const msg = (typeof error === 'string' ? error : error?.message) || '';
  return /prompt is too long/i.test(msg);
}

/** Transport-level signatures: the request never reached the provider. */
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);
const UNREACHABLE_MESSAGE_RE =
  /APIConnection(Timeout)?Error|Connection error|socket hang up|fetch failed|getaddrinfo|network (error|timeout)/i;

/**
 * True when the call never reached the provider — DNS failure, refused or reset
 * connection, connect timeout. External and transient, and specifically NOT this
 * job's process crashing: classified as `process_crash`, a blip on the way to
 * `api.anthropic.com` told a user that a forty-minute build had crashed, and
 * buried the one fact that made it actionable. Auth failures travel over a
 * working connection and belong to `isLlmAuthError`, so a status-bearing error
 * is never unreachable.
 */
export function isProviderUnreachableError(error: unknown): boolean {
  if (typeof error === 'string') return UNREACHABLE_MESSAGE_RE.test(error);
  if (!error || typeof error !== 'object') return false;
  const e = error as any;
  if (e.status ?? e.statusCode ?? e.response?.status) return false;
  const codes = [e.code, e.cause?.code, e.error?.code];
  if (codes.some((c) => typeof c === 'string' && UNREACHABLE_CODES.has(c))) return true;
  if (e.name === 'APIConnectionError' || e.name === 'APIConnectionTimeoutError') return true;
  const msg = [e.message, e.cause?.message]
    .filter((m): m is string => typeof m === 'string')
    .join(' ');
  return UNREACHABLE_MESSAGE_RE.test(msg);
}

/**
 * Collapse a raw Anthropic error message into a short, user-readable cause.
 * Keeps raw JSON out of the choice card. Falls back to the trimmed message.
 */
export function summarizeFailureCause(errorMessage: string | undefined): string {
  const msg = errorMessage || '';
  if (isProviderBalanceDepletion(msg)) return 'AI service temporarily unavailable';
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
