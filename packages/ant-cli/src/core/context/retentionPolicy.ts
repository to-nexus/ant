/**
 * Task-boundary retention policy for Context Isolation jobs (Code, Design).
 *
 * Decides whether to preserve, compact, or discard conversation history
 * between sequential tasks in a job.
 *
 * Issue 3 fix: explicit spec workType discard branch.
 */

import type { ConversationMessage } from './types';
import { compactRun } from './compactRun';
import { TokenBudgetManager } from '../utils/tokenBudget';

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
 */
export function decideRetention(ctx: RetentionContext): RetentionDecision {
  if (ctx.jobType === 'code') {
    return { action: 'discard', reason: 'code job loads fresh projectCodeContext per task' };
  }

  if (!ctx.nextTask) {
    return { action: 'discard', reason: 'no next task' };
  }

  // Issue 3: spec uses accumulated doc artifacts, no conversation needed
  if (ctx.workType === 'spec') {
    return { action: 'discard', reason: 'spec uses accumulated doc artifacts' };
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
 * applyRetention remains sync — compactRun is sync.
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
      const { result } = compactRun(ctx.conversationHistory, tokenManager, {
        microcompactHotTail: 1,
        autoCompactThreshold: 30000,
        autoCompactHotTail: 2,
      });
      console.log(
        `🗂️  [ConversationRetention] Compacted ${ctx.conversationHistory.length} → ${result.length} messages`,
      );
      return result;
    }

    case 'preserve':
      return ctx.conversationHistory;
  }
}
