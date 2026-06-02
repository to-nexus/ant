/**
 * Regression — `checkTaskStatus` must consume-and-clear `state.fileErrors`.
 *
 * RCA `sheer-mining-gavel` / task `app-shell-wiring`: a fileError produced by
 * execute is converted to a (retryable) `file_operation_failed` violation by
 * `evaluateTaskStatus`, but the raw `state.fileErrors` source was never
 * cleared. The remediation route is checkTaskStatus → plan; when the retry
 * plan is an empty no-op (`done`), `planRouter` sends control straight back
 * to checkTaskStatus, bypassing execute — the only OTHER writer of
 * `fileErrors`. The stale source was therefore re-fabricated into the same
 * violation every cycle until retries exhausted → terminal
 * `unresolved_violations`. The fix: the retryable return path of both
 * wrappers clears `fileErrors` (it is the only path reached when fileErrors
 * is non-empty, because fileError violations are always retryable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workerCheckTaskStatus } from '../../../src/agents/architect/graph/code/nodes/checkTaskStatus/workerIndex';
import { checkTaskStatus } from '../../../src/agents/architect/graph/code/nodes/checkTaskStatus';
import { evaluateTaskStatus } from '../../../src/agents/architect/graph/code/nodes/checkTaskStatus/evaluate';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 'app-shell-wiring', name: 'wiring', type: 'feature', priority: 600 },
    commandHistory: [],
    recursionCount: 1,
    recursionLimit: 1000,
    llmResponse: { done: true },
    ...overrides,
  } as any;
}

describe('checkTaskStatus consume-and-clear fileErrors', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('worker: converts fileError to retryable violation AND clears the source', async () => {
    const state = makeState({
      fileErrors: ['Search block not found in file "src/app/layout.tsx"'],
    });
    const result = await workerCheckTaskStatus(state);

    // Converted to the typed violation and routed for retry.
    expect(result.violations).toHaveLength(1);
    expect(result.violations![0].type).toBe('file_operation_failed');
    expect((result as any)._nextPlanEntry).toBe('retry');
    expect((result as any)._taskCompleted).toBe(false);

    // ★ The source is explicitly cleared in the delta (key present, value
    //   undefined) — pre-fix the key was absent so the channel retained the
    //   stale error and the next cycle re-fabricated the violation.
    expect('fileErrors' in result).toBe(true);
    expect(result.fileErrors).toBeUndefined();
  });

  it('worker: with fileErrors cleared, an empty-plan done re-entry completes (no infinite loop)', async () => {
    // Cycle 2: plan emitted an empty no-op → done=true, fileErrors already
    // cleared by cycle 1. No violation is re-fabricated → task completes.
    const state = makeState({ fileErrors: undefined, llmResponse: { done: true } as any });
    const result = await workerCheckTaskStatus(state);

    expect((result as any)._taskCompleted).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('worker: proof of the trap pre-fix — without clearing, evaluate re-fabricates the same violation', async () => {
    // If fileErrors were NOT cleared, the identical source survives to the
    // next checkTaskStatus and evaluate re-emits the violation forever.
    const persisted = makeState({
      fileErrors: ['Search block not found in file "src/app/layout.tsx"'],
    });
    const again = await evaluateTaskStatus(persisted, { logPrefix: 'cycle-2' });
    expect(again.violations).toHaveLength(1);
    expect(again.violations[0].type).toBe('file_operation_failed');
  });

  it('main graph: retryable return path also clears fileErrors (mirror symmetry)', async () => {
    const state = makeState({
      fileErrors: ['Search block not found in file "src/app/globals.css"'],
    });
    const result = await checkTaskStatus(state);

    expect(result.violations?.[0]?.type).toBe('file_operation_failed');
    expect((result as any)._nextPlanEntry).toBe('retry');
    expect('fileErrors' in result).toBe(true);
    expect(result.fileErrors).toBeUndefined();
  });
});
