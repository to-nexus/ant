/**
 * Design Graph Routing — Conditional edge functions extracted from graph.ts
 */

import { DesignGraphState } from './state';
import { getTaskConcurrency } from '../../../common/graph/parallelTypes';
import { isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';

export function routeAfterResolve(s: DesignGraphState): string {
  const isResume = s.isResume === true;
  const hasTaskQueue = Boolean(s.taskQueue && !s.taskQueue.isEmpty());
  const hasResolvedAction = Boolean(s.resolvedAction);
  const hasNewDirective = Boolean(s.overrideDirective);

  if (isResume && s.awaitingDetectClarify && hasNewDirective) {
    console.log(`🔀 [Resolve→Router] isResume + awaitingDetectClarify + newDirective → detect (clarify resume)`);
    return 'detect';
  }

  if (isResume && s.awaitingClarify && hasNewDirective) {
    console.log(`🔀 [Resolve→Router] isResume + awaitingClarify + newDirective → docGen (clarify direct)`);
    return 'docGen';
  }

  if (isResume && hasNewDirective && !hasTaskQueue && s.resolvedAction?.intentGroup === 'design-spec') {
    console.log(`🔀 [Resolve→Router] isResume + spec + newDirective (no tasks) → decompose (spec modification)`);
    return 'decompose';
  }

  if (isResume && hasTaskQueue && hasNewDirective) {
    console.log(`🔀 [Resolve→Router] isResume + taskQueue + newDirective → revise`);
    return 'revise';
  }
  if (isResume && hasTaskQueue) {
    const concurrency = getTaskConcurrency();
    if (concurrency > 1) {
      console.log(`🔀 [Resolve→Router] isResume + taskQueue, concurrency=${concurrency} → parallelOrchestrator`);
      return 'parallelOrchestrator';
    }
    console.log(`🔀 [Resolve→Router] isResume + taskQueue → plan (continue)`);
    return 'plan';
  }
  if (isResume && hasResolvedAction) {
    console.log(`🔀 [Resolve→Router] isResume + resolvedAction (no tasks) → decompose`);
    return 'decompose';
  }

  console.log(`🔀 [Resolve→Router] New job → triage`);
  return 'triage';
}

export function routeAfterDetect(s: DesignGraphState): string {
  if (s.designError) {
    console.log(`❌ [Graph] Design error detected → routing to learn for cleanup`);
    return 'learn';
  }
  if (s.awaitingDetectClarify) {
    console.log(`⏸️  [Graph] Detect clarify — paused for user choice`);
    return '__end__';
  }
  if (isFigmaPipeline(s.resolvedAction?.intent, isFigmaDataPopulated(s.figmaConfig))) {
    console.log(`🎨 [Graph] Figma pipeline (intent=${s.resolvedAction?.intent}) → figmaExplore`);
    return 'figmaExplore';
  }
  return 'decompose';
}

export function routeAfterFigmaExplore(s: DesignGraphState): string {
  if (s.designError) {
    console.log(`❌ [Graph] Figma explore failed (${s.designError.type}) → routing to learn for cleanup`);
    return 'learn';
  }
  return 'decompose';
}

export function routeAfterDecompose(s: DesignGraphState): string {
  const concurrency = getTaskConcurrency();
  if (concurrency > 1) {
    console.log(`[Design Decompose→Router] ANT_TASK_CONCURRENCY=${concurrency} → parallelOrchestrator`);
    return 'parallelOrchestrator';
  }
  console.log(`[Design Decompose→Router] ANT_TASK_CONCURRENCY=1 → sequential plan`);
  return 'plan';
}

export function routeAfterRevise(s: DesignGraphState): string {
  const concurrency = getTaskConcurrency();
  if (concurrency > 1) {
    return 'parallelOrchestrator';
  }
  return 'plan';
}

export function routeAfterCheckTaskStatus(s: DesignGraphState): string {
  if (s._assetValidationFailed) {
    return 'docGen';
  }
  if (s.interruption) {
    return 'learn';
  }
  if (s.taskQueue && !s.taskQueue.isEmpty()) {
    return 'plan';
  } else {
    return 'learn';
  }
}
