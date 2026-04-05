/**
 * Run-level orchestrator: 3-step history compaction pipeline.
 *
 * Steps:
 *   1. compactToolResults – shrink old tool_result blobs (hot-tail untouched)
 *   2. compactTurns       – if still > threshold, summarise cold turns
 *   3. pruneTurns         – trim to final token budget via priority-based pruning
 *
 * Issue 1 fix: budget propagation — pruneTurns now uses tokenManager.getHistoryBudget()
 * instead of a hardcoded 75K, so Plan (50K budget) is respected.
 */

import type { ConversationMessage } from './types';
import { compactToolResults } from './compactToolResults';
import { compactTurns } from './compactTurns';
import { TurnPruner } from './pruneTurns';
import {
  DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL,
  DEFAULT_COMPACT_TURNS_THRESHOLD,
  DEFAULT_COMPACT_TURNS_HOT_TAIL,
} from './constants';
import type { TokenBudgetManager } from '../utils/tokenBudget';

export function compactRun(
  history: ConversationMessage[],
  tokenManager: TokenBudgetManager,
  options?: {
    microcompactHotTail?: number;
    autoCompactThreshold?: number;
    autoCompactHotTail?: number;
  },
): { result: ConversationMessage[]; wasCompacted: boolean } {
  if (history.length === 0) {
    return { result: [], wasCompacted: false };
  }
  const {
    microcompactHotTail = DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL,
    autoCompactThreshold = DEFAULT_COMPACT_TURNS_THRESHOLD,
    autoCompactHotTail = DEFAULT_COMPACT_TURNS_HOT_TAIL,
  } = options || {};

  const { compacted: step1 } = compactToolResults(history, microcompactHotTail, tokenManager);
  const { compacted: step2, wasCompacted } = compactTurns(step1, autoCompactThreshold, autoCompactHotTail, tokenManager);

  // Issue 1 fix: use tokenManager's history budget instead of hardcoded 75K
  const pruner = new TurnPruner(tokenManager, {
    maxTokens: tokenManager.getHistoryBudget(),
  });
  const { prunedHistory } = pruner.pruneHistory(step2);

  return { result: prunedHistory, wasCompacted };
}
