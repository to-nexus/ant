/**
 * Code Graph Routing — Conditional edge functions extracted from graph.ts
 */

import { ArchitectGraphState } from './state';
import { getTaskConcurrency } from './parallel/types';
import { isDirectTier } from '../../../../core/executionTier';

export function routeAfterResolve(state: ArchitectGraphState): string {
  const isResume = state.isResume === true;
  const hasTaskQueue = state.taskQueue && !state.taskQueue.isEmpty();
  const hasResolvedAction = !!state.resolvedAction;
  const hasNewDirective = !!state.overrideDirective;

  console.log(`[RouteAfterResolve] isResume=${isResume}, hasTaskQueue=${hasTaskQueue}, hasResolvedAction=${hasResolvedAction}, hasNewDirective=${hasNewDirective}`);

  if (!isResume) {
    console.log(`[RouteAfterResolve] New job → triage`);
    return 'triage';
  }

  if (hasTaskQueue && hasNewDirective) {
    console.log(`[RouteAfterResolve] Resume + new directive → triage (then revise if proceed)`);
    return 'triage';
  }

  if (hasTaskQueue) {
    const queueSize = state.taskQueue?.size?.() || 0;
    const completedCount = state.completedTasks?.length || 0;
    const concurrency = getTaskConcurrency();
    if (concurrency > 1) {
      console.log(`[RouteAfterResolve] Plain resume: ${queueSize} tasks, ${completedCount} completed, concurrency=${concurrency} → parallelOrchestrator`);
      return 'parallelOrchestrator';
    }
    console.log(`[RouteAfterResolve] Plain resume: ${queueSize} tasks, ${completedCount} completed → plan`);
    return 'plan';
  }

  if (state.awaitingDecomposeClarify && (state.overrideDirective || state._specClarifyBypassed)) {
    console.log(`[RouteAfterResolve] Decompose clarify resume (bypass=${state._specClarifyBypassed === true}) → decompose`);
    return 'decompose';
  }

  if (hasResolvedAction) {
    console.log(`[RouteAfterResolve] Resume with resolvedAction → detect (pass-through)`);
    return 'detect';
  }

  console.log(`[RouteAfterResolve] Resume (no tasks, no detection) → triage`);
  return 'triage';
}

/**
 * Routes after detect. `state.resolvedAction` is the proceed signal:
 * detect populates it on success and leaves it unset on blocked /
 * redirect-suggested, where the node has already streamed displayMessage
 * + choiceOptions to chat so the FE renders the card on __end__.
 */
export function routeAfterDetect(state: ArchitectGraphState): string {
  if (state.resolvedAction) {
    console.log('[RouteAfterDetect] resolvedAction present → decompose');
    return 'decompose';
  }
  console.log('[RouteAfterDetect] no resolvedAction → __end__ (blocked / redirect / failure)');
  return '__end__';
}

export function routeAfterDecompose(state: ArchitectGraphState): string {
  if (state.awaitingDecomposeClarify || state.specClarify) {
    const reason = state.awaitingDecomposeClarify
      ? 'awaitingDecomposeClarify'
      : 'specClarify';
    console.log(`⏸️  [Decompose→Router] ${reason} → __end__`);
    return '__end__';
  }
  const tier = state.executionTier;
  const mode = state.resolvedAction?.mode;

  // Defense-in-depth guard (D from plan): Tier 0 is forbidden for
  // generate/refactor modes — validateExecutionTier + the rules.md
  // matrix should have already blocked this combination at decompose
  // time. If we still reach here with tier=0 + generate/refactor, it
  // means either (a) validateExecutionTier was bypassed, or (b) state
  // was reconstructed from a legacy session predating the contract.
  // Throwing is strictly better than silently routing to the direct
  // read-only path and completing the job with zero file changes.
  if (tier === 0 && (mode === 'generate' || mode === 'refactor')) {
    throw new Error(
      `[Decompose→Router] Invalid state: executionTier=0 with mode=${mode}. ` +
      `Tier 0 is reserved for explain mode only; generate/refactor start at Tier 1. ` +
      `This indicates a missing validateExecutionTier check upstream or a stale session — ` +
      `refusing to route to the direct read-only path as it would silently complete the job ` +
      `with no code changes.`,
    );
  }

  if (tier !== undefined && isDirectTier(tier)) {
    console.log(`[Decompose→Router] executionTier=${tier} → direct`);
    return 'direct';
  }
  const concurrency = getTaskConcurrency();
  if (concurrency > 1) {
    console.log(`[Decompose→Router] executionTier=${tier ?? 'task'} ANT_TASK_CONCURRENCY=${concurrency} → parallelOrchestrator`);
    return 'parallelOrchestrator';
  }
  console.log(`[Decompose→Router] executionTier=${tier ?? 'task'} ANT_TASK_CONCURRENCY=1 → sequential plan`);
  return 'plan';
}

export function routeAfterDirect(state: ArchitectGraphState): string {
  if (state.needsEscalation && !state._promotedThisJob) {
    console.log(`⚡ [Direct→Router] needsEscalation (not yet promoted) → decompose`);
    return 'decompose';
  }
  if (state.needsEscalation && state._promotedThisJob) {
    console.log(`🛑 [Direct→Router] needsEscalation but already promoted this job → learn (1-shot escalation cap)`);
  } else {
    console.log(`✅ [Direct→Router] direct loop complete → learn`);
  }
  return 'learn';
}

export function routeAfterRevise(state: ArchitectGraphState): string {
  const concurrency = getTaskConcurrency();
  if (concurrency > 1) {
    return 'parallelOrchestrator';
  }
  return 'plan';
}

export function routeAfterCheckTaskStatus(state: ArchitectGraphState): string {
  const hasViolations = (state.violations && state.violations.length > 0);

  if (!hasViolations) {
    return 'learn';
  }

  const remaining = (state.recursionLimit || 200) - (state.recursionCount || 0);
  if (remaining < 20) {
    console.warn(`⚠️  Insufficient recursion budget (${remaining}) for retry — moving to learn`);
    return 'learn';
  }

  if (state.retries < state.maxRetries) {
    return 'plan';
  }

  console.log(`⚠️  Task "${state.currentTask?.name}" exhausted retries (${state.retries}/${state.maxRetries})`);
  console.log(`   Unresolved violations remain — moving on to prevent infinite loop.\n`);
  return 'learn';
}

export function routeAfterLearn(state: ArchitectGraphState): string {
  if (state.interruption) {
    const reason = state.interruption.reason;
    console.log(`\n⛔ [Learn] Interruption detected (${reason}) → stopping execution\n`);
    return '__end__';
  }
  if (state.taskQueue && !state.taskQueue.isEmpty()) {
    console.log(`\n📋 [Learn] More tasks in queue (${state.taskQueue.size()} remaining) → continuing to plan\n`);
    return 'plan';
  } else {
    console.log(`\n✅ [Learn] All tasks completed! Workflow finished.\n`);
    return '__end__';
  }
}
