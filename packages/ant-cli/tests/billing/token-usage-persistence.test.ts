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
import { projectSessionStateToKanban } from '../../src/core/realtime/projectSessionStateToKanban';
import type { SessionState } from '../../src/core/types/session';
import type { TokenUsageByModel } from '@ant/shared';

const byModel: TokenUsageByModel = {
  'claude-opus-4-8': {
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
