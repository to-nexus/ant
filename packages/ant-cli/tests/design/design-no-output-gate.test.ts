/**
 * Design zero-output phantom-success guard (heavy-bridging-onion RCA).
 *
 * A design execute phase that degenerates into a read-only loop and is
 * force-drained produced ZERO artifacts, yet completion used to mark the task
 * done — a phantom success that `learn` masked with pre-existing stale files
 * and surfaced as "Design document created" + the `spec_complete` card.
 *
 * Contracts locked here:
 *   1. `isNoOutputCompletion` — trips only when the run wrote nothing AND the
 *      target is absent/empty; false when a file was produced or the target
 *      exists (refactor/append, wrong-name-but-produced).
 *   2. `buildDesignNoOutputInterruption` — resumable `design_no_output` shape.
 *   3. `DesignNoOutputError` / `isDesignNoOutputError` — orchestrator classifier.
 *   4. `routeAfterExecute` — diverts to checkTaskStatus at NO_OUTPUT_HARD_CAP.
 *   5. `applyDrainFinalization` — one salvage turn on the no-output streak,
 *      one step before the breaker.
 */

import { describe, it, expect } from 'vitest';
import {
  isNoOutputCompletion,
  buildDesignNoOutputInterruption,
} from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/outputVerification';
import { DesignNoOutputError, isDesignNoOutputError } from '../../src/agents/architect/graph/design/errors';
import { routeAfterExecute, NO_OUTPUT_HARD_CAP, DRAIN_FINALIZE_MARGIN } from '../../src/agents/architect/graph/design/routers/executeRouter';
import { applyDrainFinalization } from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';

const SPEC_TASK = { targetDir: 'architecture/spec', targetFile: 'coordinate-system.md' };

function fsWith(files: Record<string, string>) {
  return {
    async readFile(p: string): Promise<string> {
      // `p` is an absolute join; match on suffix so featurePath is irrelevant.
      const hit = Object.keys(files).find((k) => p.endsWith(k));
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[hit];
    },
  };
}

describe('isNoOutputCompletion', () => {
  it('trips: produced nothing this run AND target absent on disk', async () => {
    const fs = fsWith({}); // coordinate-system.md does not exist
    expect(await isNoOutputCompletion(fs, '/feat', SPEC_TASK, 0)).toBe(true);
  });

  it('trips: produced nothing AND target exists but is empty', async () => {
    const fs = fsWith({ 'architecture/spec/coordinate-system.md': '   \n' });
    expect(await isNoOutputCompletion(fs, '/feat', SPEC_TASK, 0)).toBe(true);
  });

  it('passes: the run wrote a file this task (accumulator > 0)', async () => {
    const fs = fsWith({});
    expect(await isNoOutputCompletion(fs, '/feat', SPEC_TASK, 2)).toBe(false);
  });

  it('passes: produced nothing this run BUT the target already exists (refactor/append)', async () => {
    const fs = fsWith({ 'architecture/spec/coordinate-system.md': '# Spec\n\n## Section\nbody\n' });
    expect(await isNoOutputCompletion(fs, '/feat', SPEC_TASK, 0)).toBe(false);
  });

  it('passes (no false-positive) when the task has no targetFile', async () => {
    const fs = fsWith({});
    expect(await isNoOutputCompletion(fs, '/feat', { targetDir: 'architecture/spec' }, 0)).toBe(false);
  });

  it('passes when fileSystem/featurePath are unavailable (cannot verify → do not block)', async () => {
    expect(await isNoOutputCompletion(undefined, '/feat', SPEC_TASK, 0)).toBe(false);
    expect(await isNoOutputCompletion(fsWith({}), undefined, SPEC_TASK, 0)).toBe(false);
  });
});

describe('buildDesignNoOutputInterruption', () => {
  it('is a resumable design_no_output interruption carrying task metadata', () => {
    const i = buildDesignNoOutputInterruption(
      { name: 'Spec: coords', targetFile: 'coordinate-system.md' },
      { callIndex: 375, completedCount: 0, tasksRemaining: 1 },
    );
    expect(i.reason).toBe('design_no_output');
    expect(i.canResume).toBe(true);
    expect(i.message).toContain('coordinate-system.md');
    expect(i.metadata).toMatchObject({ targetFile: 'coordinate-system.md', callIndex: 375 });
  });
});

describe('DesignNoOutputError classifier', () => {
  it('is recognised by instanceof and by name (serialization-robust)', () => {
    const err = new DesignNoOutputError(
      buildDesignNoOutputInterruption({ targetFile: 'x.md' }, {}),
    );
    expect(isDesignNoOutputError(err)).toBe(true);
    expect(err.interruption.reason).toBe('design_no_output');
    const plain = Object.assign(new Error('x'), { name: 'DesignNoOutputError' });
    expect(isDesignNoOutputError(plain)).toBe(true);
    expect(isDesignNoOutputError(new Error('unrelated'))).toBe(false);
  });
});

describe('routeAfterExecute — no-output circuit breaker', () => {
  const ampleRecursion = { recursionLimit: 800, recursionCount: 100 };

  it('diverts to checkTaskStatus once the streak hits NO_OUTPUT_HARD_CAP (even with tool calls pending)', () => {
    const state = {
      ...ampleRecursion,
      _noOutputCallCount: NO_OUTPUT_HARD_CAP,
      llmResponse: { done: false, toolCalls: [{ name: 'read_file' }] },
    } as any;
    expect(routeAfterExecute(state)).toBe('checkTaskStatus');
  });

  it('keeps routing to the tool node while below the cap', () => {
    const state = {
      ...ampleRecursion,
      _noOutputCallCount: NO_OUTPUT_HARD_CAP - 1,
      llmResponse: { done: false, toolCalls: [{ name: 'read_file' }] },
    } as any;
    expect(routeAfterExecute(state)).toBe('tool');
  });
});

describe('applyDrainFinalization — no-output trigger', () => {
  const NO_OUTPUT_SALVAGE_AT = NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;

  it('fires one salvage turn on the no-output streak, one step before the breaker', () => {
    const messages = [{ role: 'user', content: 'go' }];
    const { tools, drainFinalizing } = applyDrainFinalization(
      { _noOutputCallCount: NO_OUTPUT_SALVAGE_AT } as any,
      messages,
      [{ name: 'read_file' }],
    );
    expect(drainFinalizing).toBe(true);
    expect(tools).toEqual([]);
    expect((messages[0].content as any[])[1].text).toContain('without writing anything');
  });

  it('does not fire below the salvage threshold', () => {
    const { drainFinalizing } = applyDrainFinalization(
      { _noOutputCallCount: NO_OUTPUT_SALVAGE_AT - 1 } as any,
      [{ role: 'user', content: 'go' }],
      [{ name: 'read_file' }],
    );
    expect(drainFinalizing).toBe(false);
  });
});
