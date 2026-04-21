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
    // Policy rejections carry the reason in `content` (prefixed with
    // `[Policy] ` so the tool_result formatter doesn't mis-label the
    // internal guard as a command execution failure). `error` is unset.
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/ALREADY PASSED/);
    expect(result?.error).toBeUndefined();
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
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1d: build passed → ALREADY PASSED (build)', () => {
    const session = makeSession({ passed: ['typecheck', 'build'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1e: test passed → ALREADY PASSED (test)', () => {
    const session = makeSession({ passed: ['typecheck', 'build', 'test'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1f: *Passed ALREADY PASSED applies even in deep diagnostic mode', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });
});

describe('F4 — 3-gate ordering guard', () => {
  it('F4a: buildPassed=false + test command → BLOCKED (build first)', () => {
    const session = makeSession({ passed: ['typecheck'], attempted: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/build/i);
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
    expect(result?.content).toMatch(/BLOCKED/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T6b-η — error task policy
//
// Error tasks apply fixes from an upstream remediation plan and must NOT
// re-run build/test/typecheck themselves. Prior to T6b-η the legacy
// `isDiagnosticTask` alias silently permitted `go build` in error tasks
// (verification + error share the allow-list). These tests lock the
// tightened policy: only verification may drive build/test/typecheck.
// ────────────────────────────────────────────────────────────────────────────

function makeErrorCtx(opts: { activePhase?: 'plan' | 'execute' } = {}): ToolExecutionContext {
  return {
    // Error tasks never carry a VerificationSession.
    verificationSession: undefined,
    activePhase: opts.activePhase ?? 'execute',
    currentTaskType: 'error',
    isDeepDiagnostic: false,
    fileSystem: undefined as any,
    chatStatus: undefined as any,
    workingDir: '/tmp',
  } as unknown as ToolExecutionContext;
}

describe('codeCommandPolicy — Go build allow-list (verification-only after T6b-η)', () => {
  it('blocks `go build` in an error task (previously silently allowed via isDiagnosticTask)', () => {
    const ctx = makeErrorCtx();
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/verification tasks/);
    expect(result?.error).toBeUndefined();
  });

  it('blocks `go test` in an error task', () => {
    const ctx = makeErrorCtx();
    const result = applyCodeCommandPolicy(ctx, { command: 'go test ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('blocks `go vet` in a feature task (unchanged behaviour)', () => {
    const ctx = {
      verificationSession: undefined,
      activePhase: 'execute',
      currentTaskType: 'feature',
      isDeepDiagnostic: false,
      fileSystem: undefined as any,
      chatStatus: undefined as any,
      workingDir: '/tmp',
    } as unknown as ToolExecutionContext;
    const result = applyCodeCommandPolicy(ctx, { command: 'go vet ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('allows `go build` in a verification task (plan phase — diagnostic run)', () => {
    // Go project with no tests required → verification session's `required`
    // set is just `build` (no `typecheck` gate ordering). This isolates the
    // cross-cutting Go allow-list from the verification hook's gate-order
    // logic so the assertion genuinely checks the policy-level block.
    const session = makeSession({ isTs: false, hasTests: false });
    const ctx = makeCtx(session, { activePhase: 'plan' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result).toBeNull();
  });
});

describe('codeCommandPolicy — error command.guard (execute-phase build/test/typecheck block)', () => {
  it('blocks `npm run build` in error task execute phase', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/remediation plan/);
  });

  it('blocks `npm run test` in error task execute phase', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('blocks `npx tsc --noEmit` in error task execute phase', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('allows `pnpm install foo` in error task execute phase (dependency install is part of fix)', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'pnpm install foo' });
    expect(result).toBeNull();
  });

  it('allows read-only inspection commands (cat/ls) in error task execute phase', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    expect(applyCodeCommandPolicy(ctx, { command: 'ls src/' })).toBeNull();
    expect(applyCodeCommandPolicy(ctx, { command: 'cat package.json' })).toBeNull();
  });

  it('does not apply the execute-phase block in plan phase (rare no-prePlanText path needs inspection)', () => {
    const ctx = makeErrorCtx({ activePhase: 'plan' });
    // build/test/typecheck in plan phase would still be blocked by the
    // cross-cutting Go allow-list only; npm build in plan phase with no
    // verification session falls through (verification hook is absent).
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build' });
    expect(result).toBeNull();
  });
});
