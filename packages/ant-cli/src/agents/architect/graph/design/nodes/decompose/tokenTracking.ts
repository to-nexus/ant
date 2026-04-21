/**
 * Token usage tracking for design decompose LLM calls.
 *
 * Module-local `_decomposeCallIndex` counter increments per call and is
 * used as a log-filename disambiguator. Counter persists across the
 * process lifetime (same as the pre-partition behaviour in helpers.ts).
 *
 * NOTE: `resetDecomposeCallIndex` was a dead export in helpers.ts (0 callers)
 * and is deliberately dropped during partition.
 */

import type { DesignGraphState } from "../../state";

let _decomposeCallIndex = 0;

export async function trackTokenUsage(
  state: DesignGraphState,
  usage: any,
  subNode?: string,
): Promise<void> {
  if (!usage) return;
  const { accumulateTokenUsage, logTokenUsageToFile } = await import(
    '../../../../../common/graph/llmHelpers'
  );
  accumulateTokenUsage(state, usage, { taskLevel: false, jobLevel: true });
  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
  }

  logTokenUsageToFile(
    state.context?.featurePath,
    state.jobId || state._httpJobId,
    usage,
    {
      taskId: 'estimating',
      taskName: subNode || 'decompose',
      node: 'decompose',
      callIndex: _decomposeCallIndex++,
    },
  );
}
