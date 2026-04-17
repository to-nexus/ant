import { describe, it, expect } from 'vitest';
import { formatCachedPassedSteps } from '../../src/agents/architect/graph/code/nodes/plan/planGeneration';

describe('Axis C — formatCachedPassedSteps', () => {
  it('returns undefined when tracker is undefined', () => {
    expect(formatCachedPassedSteps(undefined)).toBeUndefined();
  });

  it('returns undefined when nothing is cached', () => {
    const tracker = {
      buildPassed: false,
      testPassed: false,
      testsRequired: true,
      typecheckRequired: true,
      typecheckPassed: false,
    };
    expect(formatCachedPassedSteps(tracker)).toBeUndefined();
  });

  it('lists only passed steps', () => {
    const tracker = {
      buildPassed: true,
      testPassed: false,
      testsRequired: true,
      typecheckRequired: true,
      typecheckPassed: true,
    };
    const result = formatCachedPassedSteps(tracker);
    expect(result).toMatch(/typecheck/);
    expect(result).toMatch(/build/);
    expect(result).not.toMatch(/✓ test\b/);
  });

  it('omits typecheck when not required even if passed', () => {
    const tracker = {
      buildPassed: true,
      testPassed: false,
      testsRequired: false,
      typecheckRequired: false,
      typecheckPassed: true, // stale/ignored when !typecheckRequired
    };
    const result = formatCachedPassedSteps(tracker);
    expect(result).toMatch(/build/);
    expect(result).not.toMatch(/typecheck/);
  });

  it('omits test when not required even if passed', () => {
    const tracker = {
      buildPassed: true,
      testPassed: true,
      testsRequired: false,
      typecheckRequired: false,
    };
    const result = formatCachedPassedSteps(tracker);
    expect(result).toMatch(/build/);
    expect(result).not.toMatch(/test/);
  });

  it('lists all three when every required step passed', () => {
    const tracker = {
      buildPassed: true,
      testPassed: true,
      testsRequired: true,
      typecheckRequired: true,
      typecheckPassed: true,
    };
    const result = formatCachedPassedSteps(tracker);
    expect(result).toMatch(/typecheck/);
    expect(result).toMatch(/build/);
    expect(result).toMatch(/test/);
  });
});
