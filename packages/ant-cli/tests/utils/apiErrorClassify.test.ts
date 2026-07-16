import { describe, expect, it } from 'vitest';
import {
  isOverloadedError,
  isPromptTooLongError,
  isProviderBalanceDepletion,
  summarizeFailureCause,
} from '../../src/core/utils/apiErrorClassify';

// Exact error shape captured in the `faint-gripping-charm` incident — GLM/Zhipu
// returned HTTP 429 for a hard upstream-account balance depletion (NOT the user's
// ant credits). ant retried it as a rate-limit for ~5.5min then surfaced the raw
// "Please recharge" text to a user holding 7288 credits.
const GLM_BALANCE_MSG = '429 Insufficient balance or no resource package. Please recharge.';
const GLM_BALANCE_JSON =
  '{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."},"status":429}';

// Exact error.message shape captured in the `fern-grading-knife` decompose
// crash — a codebase directory ref walked node_modules into the pool.
const PROMPT_TOO_LONG_MSG =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 7851659 tokens > 1000000 maximum"},"request_id":"req_011CciZGTXSuHne13oQsRvHh"}';

// Exact error.message shape captured in the `upper-knowing-mound` job's
// debug log when 3 UI tasks failed terminally on an Anthropic capacity outage.
const OVERLOADED_MSG =
  '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011Cbe83nAc6RV1DP1bB5WXb"}';

describe('isOverloadedError', () => {
  it('detects the real overloaded_error payload string', () => {
    expect(isOverloadedError(OVERLOADED_MSG)).toBe(true);
    expect(isOverloadedError(new Error(OVERLOADED_MSG))).toBe(true);
  });

  it('detects the Anthropic "message":"Overloaded" field and HTTP 529', () => {
    expect(isOverloadedError('{"error":{"message":"Overloaded"}}')).toBe(true);
    expect(isOverloadedError('Request failed with status 529')).toBe(true);
  });

  it('does NOT flag rate limits or genuine code defects as overloaded', () => {
    expect(isOverloadedError('{"error":{"type":"rate_limit_error"}}')).toBe(false);
    expect(isOverloadedError('TypeError: foo is not a function')).toBe(false);
    expect(isOverloadedError('verification failed: build error TS2304')).toBe(false);
    expect(isOverloadedError(undefined)).toBe(false);
    expect(isOverloadedError(null)).toBe(false);
  });
});

describe('isPromptTooLongError', () => {
  it('detects the deterministic "prompt is too long" 400 payload', () => {
    expect(isPromptTooLongError(PROMPT_TOO_LONG_MSG)).toBe(true);
    expect(isPromptTooLongError(new Error(PROMPT_TOO_LONG_MSG))).toBe(true);
  });

  it('does NOT flag transient / unrelated errors', () => {
    expect(isPromptTooLongError(OVERLOADED_MSG)).toBe(false);
    expect(isPromptTooLongError('{"error":{"type":"rate_limit_error"}}')).toBe(false);
    expect(isPromptTooLongError('TypeError: foo is not a function')).toBe(false);
    expect(isPromptTooLongError(undefined)).toBe(false);
    expect(isPromptTooLongError(null)).toBe(false);
  });
});

describe('isProviderBalanceDepletion', () => {
  it('detects the GLM/Zhipu balance-depletion 429 (string, Error, JSON, nested object)', () => {
    expect(isProviderBalanceDepletion(GLM_BALANCE_MSG)).toBe(true);
    expect(isProviderBalanceDepletion(new Error(GLM_BALANCE_MSG))).toBe(true);
    expect(isProviderBalanceDepletion(GLM_BALANCE_JSON)).toBe(true);
    expect(
      isProviderBalanceDepletion({ status: 429, error: { message: 'Insufficient balance. Please recharge.' } }),
    ).toBe(true);
  });

  it('matches each depletion signature independently', () => {
    expect(isProviderBalanceDepletion('balance is insufficient')).toBe(true);
    expect(isProviderBalanceDepletion('no resource package available')).toBe(true);
    expect(isProviderBalanceDepletion('error code: insufficient_quota')).toBe(true);
    expect(isProviderBalanceDepletion('account in arrearage')).toBe(true);
  });

  it('does NOT flag transient rate limits, overloads, or code defects', () => {
    expect(isProviderBalanceDepletion('{"error":{"type":"rate_limit_error"}}')).toBe(false);
    expect(isProviderBalanceDepletion('429 Too Many Requests')).toBe(false);
    expect(isProviderBalanceDepletion(OVERLOADED_MSG)).toBe(false);
    expect(isProviderBalanceDepletion('TypeError: foo is not a function')).toBe(false);
    expect(isProviderBalanceDepletion(undefined)).toBe(false);
    expect(isProviderBalanceDepletion(null)).toBe(false);
  });
});

describe('summarizeFailureCause', () => {
  it('collapses the raw overloaded JSON to a human label (no raw JSON leaks)', () => {
    const out = summarizeFailureCause(OVERLOADED_MSG);
    expect(out).toBe('Anthropic API overloaded');
    expect(out).not.toContain('{');
    expect(out).not.toContain('request_id');
  });

  it('labels other known transient causes', () => {
    expect(summarizeFailureCause('{"error":{"type":"rate_limit_error"}}')).toBe('API rate limit reached');
    expect(summarizeFailureCause('GraphRecursionError: recursion limit reached')).toBe('Recursion limit reached');
  });

  it('labels a provider balance depletion without leaking the raw "recharge" text', () => {
    const out = summarizeFailureCause(GLM_BALANCE_MSG);
    expect(out).toBe('AI service temporarily unavailable');
    expect(out.toLowerCase()).not.toContain('recharge');
    expect(out.toLowerCase()).not.toContain('balance');
  });

  it('lifts a nested message or trims an opaque one', () => {
    expect(summarizeFailureCause('{"error":{"message":"Something specific happened"}}')).toBe(
      'Something specific happened',
    );
    const long = 'x'.repeat(200);
    expect(summarizeFailureCause(long).length).toBeLessThanOrEqual(120);
  });
});
