/**
 * ConversationRetentionPolicy
 *
 * Centralized decision engine for whether to preserve, compact, or discard
 * conversation history between sequential tasks in a job.
 *
 * Design goals:
 * - Single source of truth for retention decisions across all job types
 * - Reuses existing compactAndPruneHistory pipeline (no new LLM calls)
 * - Easy to extend when new job types or work types are added
 */

import { ConversationMessage, compactAndPruneHistory } from './historyManager';
import { TokenBudgetManager } from './tokenBudget';

export interface RetentionDecision {
  action: 'discard' | 'compact' | 'preserve';
  reason: string;
}

export interface RetentionContext {
  jobType: 'code' | 'design';
  workType?: 'system-design' | 'ui-design' | 'spec';
  currentTask: { targetFile?: string; id: string };
  nextTask?: { targetFile?: string; id: string };
  conversationHistory: ConversationMessage[];
}

/**
 * Decide whether to discard, compact, or preserve history between tasks.
 *
 * | Condition                                   | Decision | Reason                                           |
 * |---------------------------------------------|----------|--------------------------------------------------|
 * | code job (all cases)                        | discard  | plan loads fresh projectCodeContext per task      |
 * | design + no next task                       | discard  | no more work                                     |
 * | design + system-design + same targetFile    | compact  | same doc continuation benefits from prior context |
 * | design + system-design + different file     | discard  | different doc → prior context irrelevant          |
 * | design + ui-design                          | discard  | ui docs use disk-based loadPreviousUiDocs()       |
 * | fallback                                    | discard  | safe default                                     |
 */
export function decideRetention(ctx: RetentionContext): RetentionDecision {
  if (ctx.jobType === 'code') {
    return { action: 'discard', reason: 'code job loads fresh projectCodeContext per task' };
  }

  if (!ctx.nextTask) {
    return { action: 'discard', reason: 'no next task' };
  }

  if (ctx.workType === 'ui-design') {
    return { action: 'discard', reason: 'ui-design uses disk-based loadPreviousUiDocs' };
  }

  if (ctx.workType === 'system-design') {
    const sameFile =
      ctx.currentTask.targetFile &&
      ctx.nextTask.targetFile &&
      ctx.currentTask.targetFile === ctx.nextTask.targetFile;

    if (sameFile) {
      return {
        action: 'compact',
        reason: `same targetFile (${ctx.currentTask.targetFile}) — compact for continuation`,
      };
    }
    return { action: 'discard', reason: 'different targetFile' };
  }

  return { action: 'discard', reason: 'fallback — unknown work type' };
}

/**
 * Apply the retention decision to conversation history.
 *
 * - discard → []
 * - compact → run compactAndPruneHistory with aggressive settings
 * - preserve → return as-is (currently unused but available for future needs)
 */
export function applyRetention(ctx: RetentionContext): ConversationMessage[] {
  const decision = decideRetention(ctx);

  console.log(`🗂️  [ConversationRetention] ${decision.action}: ${decision.reason}`);

  switch (decision.action) {
    case 'discard':
      return [];

    case 'compact': {
      if (ctx.conversationHistory.length === 0) return [];
      const tokenManager = new TokenBudgetManager();
      const { result } = compactAndPruneHistory(ctx.conversationHistory, tokenManager, {
        microcompactHotTail: 1,
        autoCompactThreshold: 30000,
        autoCompactHotTail: 2,
      });
      console.log(
        `🗂️  [ConversationRetention] Compacted ${ctx.conversationHistory.length} → ${result.length} messages`
      );
      return result;
    }

    case 'preserve':
      return ctx.conversationHistory;
  }
}
