/**
 * Code-job checkpoint PERSISTENCE guard — resume USD/credit reset regression.
 *
 * Sibling to `token-usage-persistence.test.ts` (post-completion projection) and
 * the runner-restore tests (restore side). This locks the CODE-job checkpoint
 * WRITE: `saveCheckpoint` must persist `tokenUsageByModel` alongside the
 * aggregate `tokenUsage`. It previously saved only `tokenUsage`, so on resume
 * the per-model map (which drives USD + credit) was gone and cost/credit reset
 * to 0 while the token total stayed cumulative.
 */
import { describe, it, expect, vi } from 'vitest';
import { saveCheckpoint } from '../../src/agents/architect/graph/code/session/checkpoint';

const byModel = {
  'claude-opus-5': {
    inputTokens: 1000, outputTokens: 500, totalTokens: 1500,
    cacheReadTokens: 100, cacheCreationTokens: 0, callCount: 4,
  },
};

function stateWith(over: Record<string, any>): any {
  return {
    context: { project: 'p', featureFolder: 'base', userLanguage: 'en' },
    deps: { session: { updateArtifacts: vi.fn(async () => {}) } },
    ...over,
  };
}

function persistedState(state: any) {
  const fn = state.deps.session.updateArtifacts as ReturnType<typeof vi.fn>;
  expect(fn).toHaveBeenCalledTimes(1);
  return fn.mock.calls[0][3].state;
}

describe('code checkpoint persists tokenUsageByModel (resume USD/credit guard)', () => {
  it('includes tokenUsageByModel alongside tokenUsage', async () => {
    const state = stateWith({
      tokenUsage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      tokenUsageByModel: byModel,
    });
    await saveCheckpoint(state);

    const persisted = persistedState(state);
    expect(persisted.tokenUsage).toEqual(state.tokenUsage);
    expect(persisted.tokenUsageByModel).toEqual(byModel);
  });

  it('omits tokenUsageByModel when the state never had it (no fabrication)', async () => {
    const state = stateWith({
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    await saveCheckpoint(state);

    expect(persistedState(state).tokenUsageByModel).toBeUndefined();
  });
});
