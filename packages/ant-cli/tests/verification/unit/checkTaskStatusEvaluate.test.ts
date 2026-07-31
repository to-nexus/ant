/**
 * L1 — `nodes/checkTaskStatus/evaluate.ts` pure judgement.
 *
 * Locks the shared violation-builder contract that backs both the main
 * graph `checkTaskStatus` and the worker subgraph `workerCheckTaskStatus`:
 *   - fileErrors → typed violations with classifier
 *   - budget-exhaustion guard is task-type-blind (dispatches hint via hook)
 *   - task-type-specific `check.evaluate` is dispatched only when the LLM
 *     signalled `<done>` and no prior violation fired
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { evaluateTaskStatus } from '../../../src/agents/architect/graph/code/nodes/checkTaskStatus/evaluate';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';

function makeState(overrides: Partial<ArchitectGraphState> = {}): ArchitectGraphState {
  return {
    currentTask: { id: 't1', name: 'task', type: 'feature', priority: 10 },
    commandHistory: [],
    llmResponse: { done: true },
    ...overrides,
  } as any;
}

describe('nodes/checkTaskStatus/evaluate', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('returns no violations when state is clean and LLM signalled done', async () => {
    const state = makeState();
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toEqual([]);
    expect(result.llmExplicitlyDone).toBe(true);
    expect(result.stopRequested).toBe(false);
    expect(result.batchSplitRequeued).toBe(false);
  });

  it('classifies `Cannot edit non-existing file` as missing_file', async () => {
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/foo.ts"'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('missing_file');
    expect(result.violations[0].file).toBe('src/foo.ts');
  });

  it('classifies `Search block not found` as file_operation_failed', async () => {
    const state = makeState({
      fileErrors: ['Search block not found in file "src/bar.ts"'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations[0].type).toBe('file_operation_failed');
    expect(result.violations[0].suggestedFix).toContain('src/bar.ts');
  });

  it('classifies `already created by task` as cross_worker_conflict', async () => {
    const state = makeState({
      fileErrors: ['File "src/baz.ts" was already created by task other-worker'],
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'worker' });
    expect(result.violations[0].type).toBe('cross_worker_conflict');
  });

  it('injects no_done_signal when LLM did not signal done', async () => {
    const state = makeState({ llmResponse: { done: false } as any });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('no_done_signal');
    // Generic task types get the generic hint — no `task.type` branching.
    expect(result.violations[0].suggestedFix).toContain('Break down the task scope');
  });

  it('frames no_done_signal as a degenerate re-read loop when the no-progress breaker tripped', async () => {
    const { NO_PROGRESS_HARD_CAP } = await import('../../../src/agents/architect/graph/code/state');
    const state = makeState({
      llmResponse: { done: false } as any,
      _noProgressStreak: NO_PROGRESS_HARD_CAP,
    } as any);
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe('no_done_signal');
    expect(result.violations[0].isRetryable).toBe(true);
    // Breaker framing names the successful re-read loop — NOT the generic
    // "recursionLimit / repeated tool failures" blame (all reads succeeded).
    expect(result.violations[0].message).toContain('no-progress circuit breaker');
    expect(result.violations[0].message).toContain('duplicate-elided');
    expect(result.violations[0].suggestedFix).toContain('do not re-read');
  });

  it('keeps the generic no_done_signal framing below the breaker threshold', async () => {
    const state = makeState({
      llmResponse: { done: false } as any,
      _noProgressStreak: 3,
    } as any);
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations[0].type).toBe('no_done_signal');
    expect(result.violations[0].message).not.toContain('no-progress circuit breaker');
    expect(result.violations[0].suggestedFix).toContain('Break down the task scope');
  });

  it('verification task picks up the verification-specific hint via hook', async () => {
    const state = makeState({
      llmResponse: { done: false } as any,
      currentTask: { id: 'v1', name: 'verify', type: 'verification', priority: 10 } as any,
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.violations[0].type).toBe('no_done_signal');
    expect(result.violations[0].suggestedFix).toContain('Verification task did not complete');
  });

  it('dispatches to hook check.evaluate only when no prior violation + done=true', async () => {
    // When fileErrors exist, budget/hook check should not fire.
    const state = makeState({
      fileErrors: ['Cannot edit non-existing file "src/a.ts"'],
      currentTask: { id: 'tc', name: 'tc', type: 'test-code', priority: 10 } as any,
    });
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    // test-code no longer publishes a check hook (single-owner: FV gate owns
    // "test suite exists" — RCA equal-nursing-drift), so no
    // incomplete_implementation can ever be produced here regardless.
    expect(result.violations.every(v => v.type !== 'incomplete_implementation')).toBe(true);
  });

  it('exposes _isStopRequested() and _batchSplitRequeued pass-through flags', async () => {
    const state = makeState({
      _isStopRequested: () => true,
      _batchSplitRequeued: true,
    } as any);
    const result = await evaluateTaskStatus(state, { logPrefix: 'test' });
    expect(result.stopRequested).toBe(true);
    expect(result.batchSplitRequeued).toBe(true);
  });

  /**
   * Completion output gate (level-dashing-plumb). A task must not complete
   * claiming success while a placement its own plan declared has not happened —
   * the code-job counterpart of design's `isNoOutputCompletion`.
   *
   * Scoped to `implementation.assets[]` on purpose: a placement is
   * disk-verifiable, so the check cannot false-positive. "Plan declared a
   * modify but nothing was written" is ambiguous (execute legitimately finds the
   * change already present) and is deliberately NOT gated.
   */
  describe('unplaced-asset completion gate', () => {
    let ws: string;

    beforeEach(() => {
      ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-unplaced-asset-'));
      fs.mkdirSync(path.join(ws, 'assets/game/models'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'assets/game/models/Duck.glb'), Buffer.alloc(120));
    });
    afterEach(() => {
      if (ws) fs.rmSync(ws, { recursive: true, force: true });
    });

    const planWithAsset = JSON.stringify({
      task: { id: 't1', goal: 'replace boss model' },
      implementation: {
        create: [], modify: [], delete: [],
        assets: [{ source: 'assets/game/models/Duck.glb', destination: 'codebase/public/models/Duck.glb' }],
      },
    });

    function assetState(over: Partial<ArchitectGraphState> = {}) {
      return makeState({ planText: planWithAsset, context: { featurePath: ws }, ...over } as any);
    }

    it('blocks completion when the declared destination was never written', async () => {
      const result = await evaluateTaskStatus(assetState(), { logPrefix: 'test' });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('asset_not_placed');
      expect(result.violations[0].isRetryable).toBe(true);
      expect(result.violations[0].suggestedFix).toContain('copy_file');
    });

    it('blocks completion when the destination holds stale bytes of a different size', async () => {
      fs.mkdirSync(path.join(ws, 'codebase/public/models'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/public/models/Duck.glb'), Buffer.alloc(198));
      const result = await evaluateTaskStatus(assetState(), { logPrefix: 'test' });
      expect(result.violations[0]?.type).toBe('asset_not_placed');
      expect(result.violations[0]?.message).toContain('stale/different bytes');
    });

    it('allows completion once the placement matches the source', async () => {
      fs.mkdirSync(path.join(ws, 'codebase/public/models'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'codebase/public/models/Duck.glb'), Buffer.alloc(120));
      const result = await evaluateTaskStatus(assetState(), { logPrefix: 'test' });
      expect(result.violations).toEqual([]);
    });

    it('stays silent for a plan that declares no asset placements', async () => {
      const plan = JSON.stringify({ implementation: { create: [], modify: [{ target: 'a.ts' }], delete: [] } });
      const result = await evaluateTaskStatus(
        makeState({ planText: plan, context: { featurePath: ws } } as any),
        { logPrefix: 'test' },
      );
      expect(result.violations).toEqual([]);
    });

    it('stays silent when the source itself is gone — not this gate\'s failure to report', async () => {
      fs.rmSync(path.join(ws, 'assets/game/models/Duck.glb'));
      const result = await evaluateTaskStatus(assetState(), { logPrefix: 'test' });
      expect(result.violations).toEqual([]);
    });

    it('does not fire before <done> — the no_done_signal guard owns that turn', async () => {
      const result = await evaluateTaskStatus(
        assetState({ llmResponse: { done: false } } as any),
        { logPrefix: 'test' },
      );
      expect(result.violations.every((v) => v.type !== 'asset_not_placed')).toBe(true);
    });
  });
});
