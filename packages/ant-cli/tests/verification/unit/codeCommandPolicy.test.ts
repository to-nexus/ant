import { describe, it, expect } from 'vitest';
import { applyCodeCommandPolicy } from '../../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext, VerificationSessionSurface } from '../../../src/agents/common/tool/types';
import { VerificationSession } from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';

/**
 * Build a VerificationSession initialised with the env flags and mutated
 * into the desired post-state via Session mutators. Keeps these tests
 * driving the production API instead of a hand-rolled tracker shape.
 *
 * The retired `attempted` knob is intentionally absent — per-cycle
 * attempt tracking was removed with `_attemptedThisCycle`. All guard
 * paths now reduce to `passed` + `required`.
 */
function makeSession(opts: {
  isTs?: boolean;
  hasTests?: boolean;
  passed?: Array<'typecheck' | 'build' | 'test'>;
} = {}): VerificationSession {
  const session = VerificationSession.createFresh({
    isTs: opts.isTs ?? true,
    hasTests: opts.hasTests ?? true,
  });
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

describe('F1 — *Passed independent guard (gate identity = `verifies`)', () => {
  it('F1a: typecheck passed → ALREADY PASSED', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' });
    // Policy rejections carry the reason in `content` (prefixed with
    // `[Policy] ` so the tool_result formatter doesn't mis-label the
    // internal guard as a command execution failure). `error` is unset.
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/ALREADY PASSED/);
    expect(result?.error).toBeUndefined();
  });

  it('F1b: typecheck not passed → pass-through', () => {
    const ctx = makeCtx(makeSession());
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' });
    expect(result).toBeNull();
  });

  it('F1c: build passed → ALREADY PASSED (build)', () => {
    const session = makeSession({ passed: ['typecheck', 'build'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1d: test passed → ALREADY PASSED (test)', () => {
    const session = makeSession({ passed: ['typecheck', 'build', 'test'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1e: *Passed ALREADY PASSED applies even in deep diagnostic mode', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('F1f: command without verifies is treated as non-gate (no Already-Passed enforcement)', () => {
    // The LLM's `verifies` declaration is the SSOT; an omitted field
    // means "not a gate command" and the guard must not auto-classify
    // by command-string regex. See
    // `docs/tmp/gate-classification-postmortem.md`.
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit' });
    expect(result).toBeNull();
  });
});

describe('F2 — gate-ordering guards (verifies-driven, post-attempted-retirement)', () => {
  it('F2a: build before typecheck-passed → BLOCKED (tsc first)', () => {
    // Empty session: typecheck required but not yet passed.
    const session = makeSession();
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/tsc --noEmit first/);
  });

  it('F2b: build after typecheck passed → pass-through', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result).toBeNull();
  });

  it('F2c: deep-diagnostic bypasses tsc-first ordering', () => {
    const session = makeSession();
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result).toBeNull();
  });

  it('F2d: re-running the same gate in one cycle is no longer system-blocked (prompt-enforced)', () => {
    // After the `attemptedThisCycle` retirement, the runtime no longer
    // blocks a second typecheck within a single plan cycle — the prompt's
    // Gate Re-run Principle and `PLAN_TOOL_LOOP_MAX` bound the behaviour
    // instead. This test locks that policy: a non-passed typecheck is
    // pass-through regardless of prior attempts.
    const session = makeSession();
    // Simulate an earlier failed typecheck in this cycle — session records
    // the failure by leaving `passed` clear (no attemptedThisCycle state
    // exists anymore).
    session.onCommand('typecheck', false);
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' });
    expect(result).toBeNull();
  });
});

describe('F4 — 3-gate ordering guard (test requires build)', () => {
  it('F4a: buildPassed=false + test command → BLOCKED (build first)', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/build/i);
  });

  it('F4b: buildPassed=true + test command → pass-through', () => {
    const session = makeSession({ passed: ['typecheck', 'build'] });
    const ctx = makeCtx(session);
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' });
    expect(result).toBeNull();
  });

  it('F4c: deep diagnostic mode bypasses build-first', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session, { isDeepDiagnostic: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' });
    expect(result).toBeNull();
  });
});

describe('F1/F4 — execute phase shares the same guards as plan phase', () => {
  it('execute phase rejects an already-passed gate (rerun prevention applies to both phases)', () => {
    // Post verification-loop postmortem: execute-phase is no longer
    // blanket-blocked. It runs under the same `already-passed` +
    // `ordering` guards as plan-phase. An already-passed gate returns
    // `ALREADY PASSED` so LLM self-validation cannot waste a cycle
    // re-running what just passed.
    const session = makeSession({
      passed: ['typecheck', 'build', 'test'],
    });
    const ctx = makeCtx(session, { activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' });
    expect(result?.content).toMatch(/ALREADY PASSED/);
  });

  it('execute phase allows the next unsatisfied gate (self-validation)', () => {
    const session = makeSession({ passed: ['typecheck'] });
    const ctx = makeCtx(session, { activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result).toBeNull();
  });

  it('execute phase enforces ordering (build before typecheck passes → BLOCKED)', () => {
    const session = makeSession({ passed: [] });
    const ctx = makeCtx(session, { activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/tsc --noEmit first/);
  });
});

describe('Regression — `marine-brushing-panel` (gate-classification-postmortem)', () => {
  it('npm run type-check (hyphenated) flips typecheck and unblocks build', () => {
    // The original incident: regex `\btypecheck\b` failed on the
    // hyphenated `type-check`, so the gate flip was dropped and the
    // following `npm run build` was wrongfully blocked. With `verifies`
    // as the SSOT, command-string spelling is irrelevant.
    const session = makeSession();
    const ctx = makeCtx(session);

    // 1) typecheck command with `verifies: 'typecheck'` is allowed.
    expect(applyCodeCommandPolicy(ctx, { command: 'npm run type-check', verifies: 'typecheck' })).toBeNull();

    // 2) Mark typecheck passed (simulating successful execution).
    session.onCommand('typecheck', true);

    // 3) `npm run build` with `verifies: 'build'` is no longer
    //    ordering-blocked.
    expect(applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' })).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Error task policy
//
// Error tasks apply fixes from an upstream remediation plan and must NOT
// re-run build/test/typecheck themselves. These tests lock the policy:
// only verification may drive build/test/typecheck; error tasks hitting
// the Go allow-list are rejected.
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

describe('codeCommandPolicy — Go build allow-list (verification-only)', () => {
  it('blocks `go build` in an error task', () => {
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

describe('codeCommandPolicy — error command.guard (execute-phase verification gate block)', () => {
  it('blocks any verifies-declared gate in error task execute phase', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/remediation plan/);

    expect(applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' })?.content).toMatch(/BLOCKED/);
    expect(applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' })?.content).toMatch(/BLOCKED/);
  });

  it('allows commands without verifies (installs, edits, inspections)', () => {
    const ctx = makeErrorCtx({ activePhase: 'execute' });
    expect(applyCodeCommandPolicy(ctx, { command: 'pnpm install foo' })).toBeNull();
    // A bare gate-form command without verifies passes the error task
    // guard (it would still be blocked downstream if the verification
    // session were present, but error tasks carry no session).
    expect(applyCodeCommandPolicy(ctx, { command: 'npm run build' })).toBeNull();
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
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result).toBeNull();
  });
});
