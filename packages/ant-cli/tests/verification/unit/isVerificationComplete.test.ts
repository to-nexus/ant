import { describe, it, expect } from 'vitest';
import { isVerificationComplete } from '../../../src/agents/architect/graph/code/utils/verificationCompleteness';

describe('Axis B — isVerificationComplete SSOT', () => {
  it('returns incomplete when tracker is undefined', () => {
    const res = isVerificationComplete(undefined);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('build');
  });

  it('returns complete when build passes and no tests required and no typecheck required', () => {
    const res = isVerificationComplete({
      buildPassed: true,
      testPassed: false,
      testsRequired: false,
    } as any);
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
  });

  it('flags typecheck missing when required but not passed', () => {
    const res = isVerificationComplete({
      buildPassed: true,
      testPassed: true,
      testsRequired: true,
      typecheckRequired: true,
      typecheckPassed: false,
    } as any);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('typecheck');
  });

  it('flags build missing when buildPassed is false', () => {
    const res = isVerificationComplete({
      buildPassed: false,
      testPassed: true,
      testsRequired: true,
      typecheckRequired: false,
    } as any);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('build');
  });

  it('flags test missing only when testsRequired', () => {
    const noReq = isVerificationComplete({
      buildPassed: true,
      testPassed: false,
      testsRequired: false,
    } as any);
    expect(noReq.ok).toBe(true);

    const withReq = isVerificationComplete({
      buildPassed: true,
      testPassed: false,
      testsRequired: true,
    } as any);
    expect(withReq.ok).toBe(false);
    expect(withReq.missing).toContain('test');
  });

  it('returns multiple missing steps in order typecheck > build > test', () => {
    const res = isVerificationComplete({
      typecheckRequired: true,
      typecheckPassed: false,
      buildPassed: false,
      testsRequired: true,
      testPassed: false,
    } as any);
    expect(res.missing).toEqual(['typecheck', 'build', 'test']);
  });

  it('complete state returns all three objectives met', () => {
    const res = isVerificationComplete({
      typecheckRequired: true,
      typecheckPassed: true,
      buildPassed: true,
      testsRequired: true,
      testPassed: true,
    } as any);
    expect(res.ok).toBe(true);
  });
});
