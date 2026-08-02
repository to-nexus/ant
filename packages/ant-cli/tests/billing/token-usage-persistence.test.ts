/**
 * Per-model token PERSISTENCE/PROJECTION — post-completion billing regression guard.
 *
 * Sibling to `token-usage-channel.test.ts`. That test locks the LIVE path (the
 * graph channel must be declared so per-model usage survives node hops). This
 * one locks the POST-COMPLETION path: once a job finishes, the FE computes
 * USD/credit from `tokenUsageByModel`, but that field is rebuilt from the
 * session file — not the (now-sealed) Redis snapshot. If the session→kanban
 * projector drops it, completed jobs lose all cost info and revert to the
 * pre-credit-system "raw tokens only" view.
 *
 * Root cause this guards: `SessionState` carried only the aggregate `tokenUsage`,
 * and `projectSessionStateToKanban` returned only `tokenUsage`, so the per-model
 * breakdown vanished the moment the job completed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectSessionStateToKanban } from '../../src/core/realtime/projectSessionStateToKanban';
import type { SessionState } from '../../src/core/types/session';
import type { TokenUsageByModel } from '@ant/shared';

const byModel: TokenUsageByModel = {
  'claude-opus-5': {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cacheReadTokens: 10,
    cacheCreationTokens: 0,
    callCount: 3,
  },
};

describe('per-model usage survives the session→kanban projection (post-completion billing guard)', () => {
  it('SessionState admits tokenUsageByModel alongside the aggregate', () => {
    // Type-level contract: this object must compile. If the field is removed
    // from SessionState, this fixture fails to typecheck and the build breaks.
    const state: Partial<SessionState> = {
      jobId: 'job-1',
      tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      tokenUsageByModel: byModel,
    };
    expect(state.tokenUsageByModel).toBe(byModel);
  });

  it('projectSessionStateToKanban emits tokenUsageByModel (not just tokenUsage)', () => {
    const kanban = projectSessionStateToKanban(
      {
        jobId: 'job-1',
        taskQueue: [],
        completedTasks: [],
        completedTasksDetails: [],
        tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        tokenUsageByModel: byModel,
      } as Partial<SessionState>,
      'job-1',
      'code',
      false,
    );

    expect(kanban.dataSource).toBe('session');
    expect(kanban.tokenUsage).toBeDefined();
    // The regression: this field used to be dropped → FE USD/credit blank.
    expect(kanban.tokenUsageByModel).toEqual(byModel);
  });

  it('projection leaves tokenUsageByModel undefined when the session never had it (no fabrication)', () => {
    const kanban = projectSessionStateToKanban(
      {
        jobId: 'job-2',
        taskQueue: [],
        completedTasks: [],
        completedTasksDetails: [],
        tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      } as Partial<SessionState>,
      'job-2',
      'code',
      false,
    );
    expect(kanban.tokenUsageByModel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Twin-channel publication pairing — design graph (oat-choosing-horse RCA).
//
// `accumulateTokenUsage` / `rollUpTaskUsageToJob` MUTATE the per-model maps on
// the node's state snapshot; LangGraph only persists what a node RETURNS. The
// design execute node returned the aggregate twins (`tokenUsage`,
// `_currentTaskTokenUsage`) but not the per-model twins, so every parallel
// worker's per-model usage was dropped from the checkpoint (3 of 29 calls
// attributed; the resumed model was missing entirely). These static pairing
// guards keep every publication site honest without simulating a full graph
// run.
// ---------------------------------------------------------------------------
describe('design graph publishes per-model twins wherever it publishes aggregates', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '../../src', rel), 'utf-8');

  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it('design execute returns pair _currentTaskTokenUsage with its per-model twin', () => {
    for (const rel of [
      'agents/architect/graph/design/nodes/execute/index.ts',
      'agents/architect/graph/design/nodes/execute/explain.ts',
    ]) {
      const src = read(rel);
      const agg = count(src, '_currentTaskTokenUsage: state._currentTaskTokenUsage');
      const perModel = count(src, '_currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel');
      expect(agg, `${rel}: aggregate returns`).toBeGreaterThan(0);
      expect(perModel, `${rel}: per-model twin must be returned at every site`).toBe(agg);
    }
  });

  it('design worker completion returns the per-task per-model delta', () => {
    const src = read('agents/architect/graph/design/parallel/workerGraph.ts');
    expect(src).toContain('_currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel');
    // The cumulative map must NOT be returned from the worker — TaskWorker's
    // fallback would report the sharedContext seed as a per-task figure.
    expect(src).not.toContain('tokenUsageByModel: state.tokenUsageByModel');
  });

  it('design serial checkTaskStatus publishes the rolled-up job map after every rollup', () => {
    const src = read('agents/architect/graph/design/graph.ts');
    // One publication per serial rollUpTaskUsageToJob site (figma pause,
    // no-output pause, task completion). The parallel path publishes via
    // `result.tokenUsageByModel` from the orchestrator instead.
    const rollups = count(src, 'rollUpTaskUsageToJob(state)');
    const published = count(src, 'tokenUsageByModel: state.tokenUsageByModel');
    expect(rollups).toBeGreaterThanOrEqual(3);
    expect(published, 'each serial rollup site must publish the mutated map').toBeGreaterThanOrEqual(rollups);
  });
});
