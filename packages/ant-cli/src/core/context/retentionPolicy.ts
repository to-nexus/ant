/**
 * Task-boundary retention policy for Context Isolation jobs (Code, Design).
 *
 * Decides whether to preserve, compact, or discard conversation history
 * between sequential tasks in a job.
 *
 * Issue 3 fix: explicit spec intentGroup discard branch.
 */

import type { ConversationMessage } from './types';
import { compactRun } from './compactRun';
import { TokenBudgetManager } from '../utils/tokenBudget';
import type { IntentGroup } from '@ant/shared';

export interface RetentionDecision {
  action: 'discard' | 'compact' | 'preserve';
  reason: string;
}

export interface RetentionContext {
  jobType: 'code' | 'design';
  intentGroup?: IntentGroup;
  currentTask: { targetFile?: string; id: string };
  nextTask?: { targetFile?: string; id: string };
  nodeHistory: ConversationMessage[];
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
  if (ctx.intentGroup === 'design-spec') {
    return { action: 'discard', reason: 'spec uses accumulated doc artifacts' };
  }

  if (ctx.intentGroup === 'design-ui') {
    return { action: 'discard', reason: 'ui-design loads previous docs from artifact pool' };
  }

  if (ctx.intentGroup === 'design-system') {
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

  return { action: 'discard', reason: 'fallback — unknown intent group' };
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
      if (ctx.nodeHistory.length === 0) return [];
      const tokenManager = new TokenBudgetManager();
      const { result } = compactRun(ctx.nodeHistory, tokenManager, {
        microcompactHotTail: 1,
        autoCompactThreshold: 30000,
        autoCompactHotTail: 2,
      });
      console.log(
        `🗂️  [ConversationRetention] Compacted ${ctx.nodeHistory.length} → ${result.length} messages`,
      );
      return result;
    }

    case 'preserve':
      return ctx.nodeHistory;
  }
}
