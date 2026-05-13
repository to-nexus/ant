/**
 * Run-level orchestrator: 2-step history compaction pipeline.
 *
 * Steps:
 *   1. compactTurns – if total > threshold, summarise cold turns into rule-based summary
 *   2. pruneTurns   – trim to final token budget via priority-based pruning
 *
 * History budget propagation: pruneTurns uses tokenManager.getHistoryBudget()
 * instead of a hardcoded ceiling so per-job budgets (e.g. Plan's 50K) are respected.
 */

import type { ConversationMessage } from './types';
import { compactTurns } from './compactTurns';
import { TurnPruner } from './pruneTurns';
import {
  DEFAULT_COMPACT_TURNS_THRESHOLD,
  DEFAULT_COMPACT_TURNS_HOT_TAIL,
} from './constants';
import type { TokenBudgetManager } from '../utils/tokenBudget';

export function compactRun(
  history: ConversationMessage[],
  tokenManager: TokenBudgetManager,
  options?: {
    autoCompactThreshold?: number;
    autoCompactHotTail?: number;
  },
): { result: ConversationMessage[]; wasCompacted: boolean } {
  if (history.length === 0) {
    return { result: [], wasCompacted: false };
  }
  const {
    autoCompactThreshold = DEFAULT_COMPACT_TURNS_THRESHOLD,
    autoCompactHotTail = DEFAULT_COMPACT_TURNS_HOT_TAIL,
  } = options || {};

  const { compacted: step1, wasCompacted } = compactTurns(history, autoCompactThreshold, autoCompactHotTail, tokenManager);

  const pruner = new TurnPruner(tokenManager, {
    maxTokens: tokenManager.getHistoryBudget(),
  });
  const { prunedHistory } = pruner.pruneHistory(step1);

  return { result: prunedHistory, wasCompacted };
}
