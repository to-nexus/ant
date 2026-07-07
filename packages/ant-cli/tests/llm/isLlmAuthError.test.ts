/**
 * isLlmAuthError — SSOT auth-failure detector across providers.
 *
 * Locks the classification that maps a bad/missing API key to the
 * `llm_auth_failed` interruption reason (non-resumable). Covers the four
 * provider error shapes plus the factory's typed missing-key error, and
 * asserts non-auth errors are NOT misclassified.
 */

import { describe, it, expect } from 'vitest';
import { isLlmAuthError, LlmAuthError } from '../../src/core/llm/isLlmAuthError';

describe('isLlmAuthError', () => {
  it('detects the factory-thrown LlmAuthError and preserves provider', () => {
    const err = new LlmAuthError('No API key configured for deepseek', 'deepseek', 'DEEPSEEK_API_KEY');
    const r = isLlmAuthError(err);
    expect(r.isAuth).toBe(true);
    expect(r.provider).toBe('deepseek');
  });

  it('detects Anthropic authentication_error / invalid_api_key shapes', () => {
    expect(isLlmAuthError({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }).isAuth).toBe(true);
    expect(isLlmAuthError({ error: { type: 'invalid_api_key' } }).isAuth).toBe(true);
  });

  it('detects OpenAI/DeepSeek invalid_api_key code and 401 status', () => {
    expect(isLlmAuthError({ status: 401, message: 'Unauthorized' }).isAuth).toBe(true);
    expect(isLlmAuthError({ code: 'invalid_api_key' }).isAuth).toBe(true);
    expect(isLlmAuthError({ error: { code: 'invalid_api_key' } }).isAuth).toBe(true);
    expect(isLlmAuthError({ status: 403 }).isAuth).toBe(true);
  });

  it('detects auth via message substring fallback', () => {
    expect(isLlmAuthError(new Error('Incorrect API key provided')).isAuth).toBe(true);
    expect(isLlmAuthError(new Error('No API key is set for this provider')).isAuth).toBe(true);
  });

  it('does NOT misclassify non-auth errors', () => {
    expect(isLlmAuthError(new Error('Request timed out')).isAuth).toBe(false);
    expect(isLlmAuthError({ status: 500, message: 'internal error' }).isAuth).toBe(false);
    expect(isLlmAuthError({ error: { type: 'rate_limit_error' } }).isAuth).toBe(false);
    expect(isLlmAuthError({ error: { type: 'overloaded_error' } }).isAuth).toBe(false);
    expect(isLlmAuthError(null).isAuth).toBe(false);
    expect(isLlmAuthError(undefined).isAuth).toBe(false);
    expect(isLlmAuthError('some string').isAuth).toBe(false);
  });
});
