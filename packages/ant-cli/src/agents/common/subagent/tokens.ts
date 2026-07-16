/**
 * foldSubagentUsage — fold buffered child usage into the parent's token
 * channels, at drain/join sites only (node context — serialized with the
 * parent's own accumulate calls; the runner itself never touches state).
 *
 * Returns an EXPLICIT channel delta the caller must spread into its node
 * return — same unreturned-channel-drop class as the Track 1 recursionCount
 * fix: mutating state without returning the channels drops them on the node
 * transition. `currentPhaseTokenUsage` is deliberately NOT written: the child
 * is a separate conversation, so folding it there would corrupt the parent's
 * context-fullness gauge.
 */

import type { SubagentEntry } from './types';

export async function foldSubagentUsage(
  state: Record<string, any>,
  entries: SubagentEntry[],
): Promise<Record<string, any>> {
  const withUsage = entries.filter((e) => e.result?.usage);
  if (withUsage.length === 0) return {};

  // Channel declaredness must be captured BEFORE accumulate — the helper
  // creates task-level fields on the state object even when the graph never
  // declared them, and returning unknown keys is an InvalidUpdateError.
  const CHANNELS = [
    'tokenUsage',
    'tokenUsageByModel',
    '_currentTaskTokenUsage',
    '_currentTaskTokenUsageByModel',
  ] as const;
  const declared = new Set(CHANNELS.filter((key) => key in state));

  const { accumulateTokenUsage } = await import('../graph/llmHelpers');
  for (const e of withUsage) {
    accumulateTokenUsage(state as any, e.result!.usage as any, {
      taskLevel: true,
      jobLevel: true,
      modelId: e.result!.modelId,
    });
  }

  const delta: Record<string, any> = {};
  for (const key of CHANNELS) {
    if (declared.has(key) && state[key] !== undefined) delta[key] = state[key];
  }
  return delta;
}
