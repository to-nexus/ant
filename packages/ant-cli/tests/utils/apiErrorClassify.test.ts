import { describe, expect, it } from 'vitest';
import { isOverloadedError, summarizeFailureCause } from '../../src/core/utils/apiErrorClassify';

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

  it('lifts a nested message or trims an opaque one', () => {
    expect(summarizeFailureCause('{"error":{"message":"Something specific happened"}}')).toBe(
      'Something specific happened',
    );
    const long = 'x'.repeat(200);
    expect(summarizeFailureCause(long).length).toBeLessThanOrEqual(120);
  });
});
