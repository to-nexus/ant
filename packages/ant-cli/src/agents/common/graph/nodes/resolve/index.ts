/**
 * Resolve Node — Common Factory
 *
 * Unified resolve node replacing per-job resolve implementations.
 * Uses Strategy pattern: job-specific artifact loading is injected,
 * common infrastructure (locale, banner, workflow, timing) is handled here.
 *
 * Pattern: Factory (same as detect) because job-specific artifact loading
 * varies significantly (code loads codebase, design loads figma, etc.).
 */

import type { ResolvableState, ResolveStrategy } from './types.js';
import { detectUILocale, getEstimatingLabel, type UILocale } from '../../timing/estimatingLabels.js';

export { type ResolvableState, type ResolveStrategy } from './types.js';

/**
 * Create a resolve node bound to a job-specific strategy.
 * The returned function is added directly to the LangGraph as a node.
 *
 * ```ts
 * graph.addNode('resolve', createResolveNode(codeResolveStrategy));
 * ```
 */
export function createResolveNode<T extends ResolvableState>(
  strategy: ResolveStrategy<T>,
): (state: T) => Promise<Partial<T>> {
  return async (state: T): Promise<Partial<T>> => {
    const phaseStart = Date.now();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. UI locale detection (first node to run)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    state._uiLocale = detectUILocale(state.overrideDirective || state.directive || '');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Pre-banner init for new jobs (jobTiming before first broadcast)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let initResult: Partial<T> = {} as Partial<T>;
    if (!state.isResume && strategy.initNewJob) {
      initResult = await strategy.initNewJob(state);
      // Keep a single state object across resolve steps so loadArtifacts can
      // consume init fields (e.g. jobId) in the same turn.
      Object.assign(state, initResult);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Activity banner (broadcasts WITH jobTiming if initNewJob set it)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(
        getEstimatingLabel('resolve', state._uiLocale as UILocale | undefined),
        'resolve',
      );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Recursion count
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    state.recursionCount = (state.recursionCount || 0) + 1;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. Workflow instrumentation: enter
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.enterNode(
        state._httpJobId,
        'resolve',
        0,
        undefined,
        undefined,
        state.recursionCount,
        state.recursionLimit,
      );
    }

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 6. Delegate to strategy (resume or new job)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const strategyResult = state.isResume
        ? await strategy.onResume(state)
        : await strategy.loadArtifacts(state);

      return {
        ...initResult,
        ...strategyResult,
        _uiLocale: state._uiLocale,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        _phaseTimings: { ...(state._phaseTimings || {}), resolve: Date.now() - phaseStart },
      } as unknown as Partial<T>;
    } finally {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 7. Workflow instrumentation: exit
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
      }
    }
  };
}
