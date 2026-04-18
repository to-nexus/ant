import { describe, it, expect } from 'vitest';
import { applyCodeCommandPolicy } from '../../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext, VerificationTracker } from '../../../src/agents/common/tool/types';

type TrackerOverrides = Partial<VerificationTracker>;

function makeTracker(overrides: TrackerOverrides = {}): VerificationTracker {
  return {
    typecheckRequired: true,
    typecheckAttempted: false,
    typecheckPassed: false,
    buildAttempted: false,
    buildPassed: false,
    testAttempted: false,
    testPassed: false,
    ...overrides,
  };
}

function makeCtx(
  tracker: VerificationTracker,
  opts: {
    activePhase?: 'plan' | 'execute';
    isDeepDiagnostic?: boolean;
    taskType?: string;
  } = {},
): ToolExecutionContext {
  return {
    verificationTracker: tracker,
    activePhase: opts.activePhase ?? 'plan',
    currentTaskType: opts.taskType ?? 'verification',
    isDeepDiagnostic: opts.isDeepDiagnostic ?? false,
    // Minimal fields — handlers only touch the ones above.
    fileSystem: undefined as any,
    chatStatus: undefined as any,
    workingDir: '/tmp',
  } as unknown as ToolExecutionContext;
}

describe('F1 — *Passed independent guard', () => {
  it('F1a: typecheckPassed=true + typecheckAttempted=false → ALREADY PASSED', () => {
    // retry/reverify boundary: *Attempted was just reset, but the cache must still block re-execution.
    const ctx = makeCtx(makeTracker({ typecheckPassed: true, typecheckAttempted: false }));
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1b: typecheckPassed=false + typecheckAttempted=false → pass-through', () => {
    const ctx = makeCtx(makeTracker());
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result).toBeNull();
  });

  it('F1c: typecheckPassed=true + typecheckAttempted=true → ALREADY PASSED', () => {
    const ctx = makeCtx(makeTracker({ typecheckPassed: true, typecheckAttempted: true }));
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1d: buildPassed=true → ALREADY PASSED (build)', () => {
    const ctx = makeCtx(makeTracker({ typecheckPassed: true, buildPassed: true }));
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1e: testPassed=true → ALREADY PASSED (test)', () => {
    const ctx = makeCtx(makeTracker({
      typecheckPassed: true,
      buildPassed: true,
      testPassed: true,
    }));
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1f: *Passed ALREADY PASSED applies even in deep diagnostic mode', () => {
    const ctx = makeCtx(
      makeTracker({ typecheckPassed: true, typecheckAttempted: true }),
      { isDeepDiagnostic: true },
    );
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });
});

describe('F4 — 3-gate ordering guard', () => {
  function baseTypecheckedTracker(extra: TrackerOverrides = {}): VerificationTracker {
    return makeTracker({
      typecheckPassed: true,
      typecheckAttempted: true,
      ...extra,
    });
  }

  it('F4a: buildPassed=false + test command → BLOCKED (build first)', () => {
    const ctx = makeCtx(baseTypecheckedTracker());
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.error).toMatch(/BLOCKED/);
    expect(result?.error).toMatch(/build/i);
  });

  it('F4b: buildPassed=true + test command → pass-through', () => {
    const ctx = makeCtx(baseTypecheckedTracker({ buildPassed: true }));
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result).toBeNull();
  });

  it('F4c: deep diagnostic mode bypasses build-first', () => {
    const ctx = makeCtx(baseTypecheckedTracker(), { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result).toBeNull();
  });
});

describe('F1/F4 — non-plan phase is not guarded by plan-phase gates', () => {
  it('execute phase rejects verification commands regardless of *Passed', () => {
    const ctx = makeCtx(
      makeTracker({ typecheckPassed: true, buildPassed: true, testPassed: true }),
      { activePhase: 'execute' },
    );
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    // Execute-phase guard message, not ALREADY PASSED.
    expect(result?.error).toMatch(/BLOCKED/);
  });
});
