/**
 * Detect Node — Unified Pipeline
 *
 * Single detect node for all jobs. Two mutually exclusive paths converge
 * into one resolveToRAC() funnel:
 *
 *   explicit (metadata.explicit=true) → metadata provides all slots → resolveToRAC
 *   infer    → strategy.run() → InferredAction → merge with metadata → resolveToRAC
 *
 * Invariant: after detect completes normally, state.resolvedAction is ALWAYS populated
 * and immutable. state.resolvedArtifacts holds materialized file contents.
 */

import type { DetectableState, DetectStrategy } from './types.js';
import type { InferredAction, IntentId, ResolvedActionContext } from '@ant/shared';
import {
  resolveToRAC,
  mergeWithMetadata,
  isValidIntentId,
} from '@ant/shared';
import { loadResolvedArtifacts } from '../../loadDocumentsForRAC.js';
import { getEstimatingLabel, type UILocale } from '../../timing/estimatingLabels.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';
import { appendOrUpdatePool } from '../../../../../core/prompt/builder/ArtifactPipeline.js';
import { emitDetectOutcome } from '../../../../../core/streaming/emitDetectOutcome.js';

export { type DetectableState, type DetectStrategy, type DetectResult } from './types.js';

/**
 * Create a detect node bound to a job-specific strategy.
 * The returned function is added directly to the LangGraph as a node.
 */
export function createDetectNode<T extends DetectableState>(
  strategy: DetectStrategy<T>,
): (state: T) => Promise<Partial<T>> {
  return async (state: T): Promise<Partial<T>> => {
    const phaseStart = Date.now();

    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(
        getEstimatingLabel('detect', state._uiLocale as UILocale | undefined),
        'detect',
      );
    }

    state.recursionCount = (state.recursionCount || 0) + 1;

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.enterNode(
        state._httpJobId,
        'detect',
        0,
        undefined,
        state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
        state.recursionCount,
        state.recursionLimit,
      );
    }

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 0: Resume fast path
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.resolvedAction && !strategy.isAwaitingInput?.(state)) {
        console.log(`🔍 [detect] Resume — using existing resolvedAction (LLM skip)`);
        console.log(`   mode=${state.resolvedAction.mode}, intent=${state.resolvedAction.intent}`);

        const strategyResumeUpdates = strategy.onResume?.(state) || {};

        emitRACSummary(state.resolvedAction, undefined, state._uiLocale);

        return {
          resolvedAction: state.resolvedAction,
          ...strategyResumeUpdates,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
        } as unknown as Partial<T>;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 1: Branch on explicit
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      let intentId: string;
      let slots: { target?: string[]; refs?: string[]; context?: string[]; domain?: import('@ant/shared').DesignDomain };
      let source: 'explicit' | 'infer';
      let basis: import('@ant/shared').Basis | undefined;
      let reasoning: InferredAction['reasoning'] | undefined;
      let inferStateUpdates: Partial<T> | undefined;

      if (state.actionMetadata?.explicit) {
        // ── Explicit path: metadata provides all slots. No LLM. ──
        const metadata = state.actionMetadata;
        if (!metadata.intent) {
          throw new Error('[detect] explicit=true but no intent provided in actionMetadata');
        }
        intentId = metadata.intent;
        slots = {
          target: metadata.target,
          refs: metadata.refs,
          context: metadata.context,
        };
        source = 'explicit';
        basis = metadata.basis;
        console.log(`⚡ [detect] Explicit: intent=${intentId}`);

      } else {
        // ── Infer path: strategy.run() → InferredAction ──
        const result = await strategy.run(state);

        if (result.skipRACCreation || !result.inferred) {
          return {
            ...result.stateUpdates,
            tokenUsage: state.tokenUsage,
            recursionCount: state.recursionCount,
            recursionLimit: state.recursionLimit,
            _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
          } as unknown as Partial<T>;
        }

        const inferred = result.inferred;
        inferStateUpdates = result.stateUpdates;

        // Validate intentId
        if (!isValidIntentId(inferred.intentId)) {
          console.error(`❌ [detect] Invalid intentId "${inferred.intentId}" from strategy. Hard fail.`);
          throw new Error(`[detect] Strategy returned invalid intentId: "${inferred.intentId}"`);
        }

        // Merge with metadata supplements
        const merged = mergeWithMetadata(inferred, state.actionMetadata);
        intentId = merged.intentId;
        slots = {
          target: merged.target,
          refs: merged.refs,
          context: merged.context,
          domain: merged.domain,
        };
        source = 'infer';
        basis = merged.basis;
        reasoning = inferred.reasoning;

        console.log(`📋 [detect] Infer: intentId=${intentId}`);
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Phase 2: Unified funnel — resolveToRAC
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (!isValidIntentId(intentId)) {
        throw new Error(`[detect] No valid intentId after merge: "${intentId}"`);
      }

      const resolvedAction = resolveToRAC(intentId as IntentId, slots, source, basis);
      console.log(`📋 [detect] RAC created: intent=${intentId}, mode=${resolvedAction.mode}, source=${source}`);

      // Load resolved artifacts (skip if planner resolve already populated them)
      const featurePath = resolveFeaturePath(state);
      let resolvedArtifacts = state.resolvedArtifacts;
      if (!resolvedArtifacts?.length && featurePath) {
        resolvedArtifacts = loadResolvedArtifacts(resolvedAction, featurePath);
      }

      // Unified chat emission — explicit / infer both go through the single
      // SpecialTagTransformer entry. `reasoning` is included when present
      // (infer path); absence only omits the reasoning subsection.
      emitRACSummary(resolvedAction, reasoning, state._uiLocale);

      // Merge RAC docs into design pool (no-op for jobs without state.artifacts)
      const updatedArtifacts = (state as any).artifacts
        ? appendOrUpdatePool((state as any).artifacts, resolvedArtifacts || [])
        : undefined;

      return {
        resolvedAction,
        resolvedArtifacts,
        ...(updatedArtifacts !== undefined ? { artifacts: updatedArtifacts } : {}),
        ...inferStateUpdates,
        tokenUsage: state.tokenUsage,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
      } as unknown as Partial<T>;
    } finally {
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'detect', 0);
      }
    }
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Internal helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function resolveFeaturePath<T extends DetectableState>(state: T): string | undefined {
  return state.featurePath || (state as any).context?.featurePath;
}

/**
 * Fire-and-forget chat emission for the detect phase. Never awaited so graph
 * execution stays non-blocking; rendering failures surface via emitDetectOutcome's
 * own warn logging (no silent swallow — see .cursorrules Canonical Tag Rendering SSOT).
 */
function emitRACSummary(
  rac: ResolvedActionContext,
  reasoning: InferredAction['reasoning'] | undefined,
  locale: string | undefined,
): void {
  void emitDetectOutcome(rac, { reasoning, locale, phase: 'detect' });
}
