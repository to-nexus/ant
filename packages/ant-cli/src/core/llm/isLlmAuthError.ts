/**
 * LLM auth-failure detection — the SINGLE owner of "is this error a bad/missing
 * API key?" across every provider (Anthropic / OpenAI / DeepSeek / Gemini).
 *
 * A bad or missing key is NOT retryable and NOT resumable (resuming re-sends the
 * same key), so callers map a positive result to the `llm_auth_failed`
 * interruption reason with `canResume:false`. Wiring sites: `job-runner.ts`
 * (single-shot node backstop) and `graph.ts::classifyOrchestratorFailure`
 * (parallel code path).
 */

import type { ModelProvider } from '@ant/shared';

/** Thrown by the LLM factory when a provider's key env var is empty, so a
 * missing key produces the same clean auth card as a bad key without a wasted
 * request to the provider. */
export class LlmAuthError extends Error {
  readonly isLlmAuthError = true;
  readonly provider?: ModelProvider;
  readonly envVar?: string;
  constructor(message: string, provider?: ModelProvider, envVar?: string) {
    super(message);
    this.name = 'LlmAuthError';
    this.provider = provider;
    this.envVar = envVar;
  }
}

export interface LlmAuthErrorInfo {
  isAuth: boolean;
  provider?: ModelProvider;
}

// Anthropic-style `error.type` values that mean "auth".
const AUTH_TYPES = new Set(['authentication_error', 'invalid_api_key', 'permission_error']);
// OpenAI/DeepSeek-style `code` values that mean "auth".
const AUTH_CODES = new Set(['invalid_api_key', 'invalid_authentication', 'account_deactivated']);
const AUTH_MESSAGE_RE =
  /invalid[_ ]api[_ ]key|authentication[_ ]error|unauthorized|incorrect api key|no api key|api key.*(missing|not set|empty)/i;

/**
 * Classify an arbitrary thrown error as an LLM auth failure. Provider is
 * returned only when reliably known (our own `LlmAuthError`); SDK errors do not
 * carry a provider tag, so it may be undefined even when `isAuth` is true.
 */
export function isLlmAuthError(error: unknown): LlmAuthErrorInfo {
  if (!error || typeof error !== 'object') return { isAuth: false };
  const e = error as any;

  if (e instanceof LlmAuthError || e.isLlmAuthError === true) {
    return { isAuth: true, provider: e.provider };
  }

  const status = e.status ?? e.statusCode ?? e.response?.status;
  if (status === 401 || status === 403) return { isAuth: true };

  const type = e.error?.type ?? e.type;
  if (typeof type === 'string' && AUTH_TYPES.has(type)) return { isAuth: true };

  const code = e.code ?? e.error?.code;
  if (typeof code === 'string' && AUTH_CODES.has(code)) return { isAuth: true };

  const msg = typeof e.message === 'string' ? e.message : '';
  if (AUTH_MESSAGE_RE.test(msg)) return { isAuth: true };

  return { isAuth: false };
}
