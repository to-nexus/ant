/**
 * Join barrier — called by reasoning nodes at their finalization branch.
 * Returns null when nothing is owed; otherwise the report blocks to inject
 * and the token-channel delta to spread into the node return. The caller
 * withholds finalization, appends `user(blocks)` to its conversation, sets
 * `_subagentJoinRedo: true`, and lets its router re-enter the node.
 */

import type { MessageContentBlock } from '../../../core/ports/llm';
import { buildReportBlocks, detectOrphanedLaunches } from './drain';
import { collectCompleted, hasPending, joinAll } from './registry';
import { foldSubagentUsage } from './tokens';

export async function maybeJoinSubagents(
  state: Record<string, any>,
  ownerKey: string,
  opts?: {
    /** Conversation history — enables orphan LOST detection for phases that finalize without any tool round. */
    history?: Array<{ role: string; content: unknown }>;
  },
): Promise<{ blocks: MessageContentBlock[]; tokenDelta: Record<string, any> } | null> {
  const orphanBlocks = detectOrphanedLaunches(opts?.history, ownerKey);

  if (hasPending(ownerKey)) {
    console.log(`⏳ [Subagent] Join barrier: waiting for pending explore(s) (owner: ${ownerKey})`);
    await joinAll(ownerKey);
  }
  const completed = collectCompleted(ownerKey);

  const blocks = [...orphanBlocks, ...buildReportBlocks(completed)];
  if (blocks.length === 0) return null;

  const tokenDelta = await foldSubagentUsage(state, completed);
  console.log(`🔀 [Subagent] Join delivered ${completed.length} report(s)${orphanBlocks.length ? ` + ${orphanBlocks.length} LOST` : ''} (owner: ${ownerKey})`);
  return { blocks, tokenDelta };
}
