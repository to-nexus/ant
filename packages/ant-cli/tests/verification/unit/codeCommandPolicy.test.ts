/**
 * L1 — `applyCodeCommandPolicy` invariants (post plan §5.4).
 *
 * The deterministic gate guards (already-passed, ordering, deep-mode
 * bypass) were retired with the verification Session. The remaining
 * runtime guards are:
 *
 *   - Go build allow-list: `go build/test/run/vet` are blocked outside a
 *     verification cycle (`ctx.verifyModeActive === true`).
 *   - Per-task-type guard dispatch: `error` task type's apply-phase
 *     `command.guard` blocks `verifies`-declared gates.
 */

import { describe, it, expect } from 'vitest';
import { applyCodeCommandPolicy } from '../../../src/agents/common/tool/handlers/codeCommandPolicy';
import type { ToolExecutionContext } from '../../../src/agents/common/tool/types';

function makeCtx(opts: {
  taskType?: string;
  activePhase?: 'plan' | 'execute';
  verifyModeActive?: boolean;
} = {}): ToolExecutionContext {
  return {
    activePhase: opts.activePhase ?? 'plan',
    currentTaskType: opts.taskType ?? 'verification',
    verifyModeActive: opts.verifyModeActive ?? false,
    fileSystem: undefined as any,
    chatStatus: undefined as any,
    workingDir: '/tmp',
  } as unknown as ToolExecutionContext;
}

describe('codeCommandPolicy — Go build allow-list (verification-cycle-only)', () => {
  it('blocks `go build` in an error task', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result?.content).toMatch(/\[Policy\]/);
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/verification cycle/);
    expect(result?.error).toBeUndefined();
  });

  it('blocks `go test` in an error task', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go test ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('blocks `go vet` in a feature task', () => {
    const ctx = makeCtx({ taskType: 'feature', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'go vet ./...' });
    expect(result?.content).toMatch(/BLOCKED/);
  });

  it('allows `go build` when verify-mode is active', () => {
    const ctx = makeCtx({ taskType: 'verification', verifyModeActive: true });
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result).toBeNull();
  });
});

describe('codeCommandPolicy — error command.guard (execute-phase gate block)', () => {
  it('blocks any verifies-declared gate in error task execute phase', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result?.content).toMatch(/BLOCKED/);
    expect(result?.content).toMatch(/remediation plan/);

    expect(applyCodeCommandPolicy(ctx, { command: 'npm run test', verifies: 'test' })?.content).toMatch(/BLOCKED/);
    expect(applyCodeCommandPolicy(ctx, { command: 'npx tsc --noEmit', verifies: 'typecheck' })?.content).toMatch(/BLOCKED/);
  });

  it('allows commands without verifies (installs, edits, inspections)', () => {
    const ctx = makeCtx({ taskType: 'error', activePhase: 'execute' });
    expect(applyCodeCommandPolicy(ctx, { command: 'pnpm install foo' })).toBeNull();
    // A bare gate-form command without verifies passes the error task
    // guard (it would still be blocked downstream if a verification
    // session were present, but error tasks carry none).
    expect(applyCodeCommandPolicy(ctx, { command: 'npm run build' })).toBeNull();
  });
});
