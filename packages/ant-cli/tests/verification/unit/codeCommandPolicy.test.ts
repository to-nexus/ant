import { describe, it, expect } from 'vitest';
import { applyCodeCommandPolicy } from '../../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext, VerificationSessionSurface } from '../../../src/agents/common/tool/types';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';

/**
 * Build a VerificationSession initialised with the env flags and mutated
 * into the desired post-state via Session mutators. Keeps these tests
 * driving the production API instead of a hand-rolled tracker shape.
 */
function makeSession(opts: {
  isTs?: boolean;
  hasTests?: boolean;
  passed?: Array<'typecheck' | 'build' | 'test'>;
  attempted?: Array<'typecheck' | 'build' | 'test'>;
} = {}): VerificationSession {
  const session = VerificationSession.createFresh({
    isTs: opts.isTs ?? true,
    hasTests: opts.hasTests ?? true,
  });
  for (const gate of opts.attempted ?? []) {
    session.markAttempted(gate);
  }
  for (const gate of opts.passed ?? []) {
    session.onCommand(gate, true);
  }
  return session;
}

function makeCtx(
  session: VerificationSessionSurface,
  opts: {
    activePhase?: 'plan' | 'execute';
    isDeepDiagnostic?: boolean;
    taskType?: string;
  } = {},
): ToolExecutionContext {
  return {
    verificationSession: session,
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
  it('F1a: typecheck passed + not yet attempted this cycle → ALREADY PASSED', () => {
    // retry/reverify boundary: Session clears attemptedThisCycle on
    // `onPlanEntry`, but the passed gate cache must still block re-runs.
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1b: typecheck not passed and not attempted → pass-through', () => {
    const ctx = makeCtx(makeSession());
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result).toBeNull();
  });

  it('F1c: typecheck passed + attempted in cycle → ALREADY PASSED', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1d: build passed → ALREADY PASSED (build)', () => {
    const session = makeSession({ passed: ['typecheck', 'build'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1e: test passed → ALREADY PASSED (test)', () => {
    const session = makeSession({ passed: ['typecheck', 'build', 'test'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });

  it('F1f: *Passed ALREADY PASSED applies even in deep diagnostic mode', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.error).toMatch(/ALREADY PASSED/);
  });
});

describe('F4 — 3-gate ordering guard', () => {
  it('F4a: buildPassed=false + test command → BLOCKED (build first)', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.error).toMatch(/BLOCKED/);
    expect(result?.error).toMatch(/build/i);
  });

  it('F4b: buildPassed=true + test command → pass-through', () => {
    const session = makeSession({
      passed: ['typecheck', 'build'],
      attempted: ['typecheck', 'build'],
    });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result).toBeNull();
  });

  it('F4c: deep diagnostic mode bypasses build-first', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result).toBeNull();
  });
});

describe('F1/F4 — non-plan phase is not guarded by plan-phase gates', () => {
  it('execute phase rejects verification commands regardless of *Passed', () => {
    const session = makeSession({
      passed: ['typecheck', 'build', 'test'],
      attempted: ['typecheck', 'build', 'test'],
    });
    const ctx = makeCtx(session, { activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    // Execute-phase guard message, not ALREADY PASSED.
    expect(result?.error).toMatch(/BLOCKED/);
  });
});
