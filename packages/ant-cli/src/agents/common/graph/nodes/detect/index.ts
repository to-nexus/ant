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
import type { Basis, InferredAction, IntentId, ResolvedActionContext, Domain } from '@ant/shared';
import {
  resolveToRAC,
  mergeWithMetadata,
  isValidIntentId,
  getConfigSlots,
  getDefaultTargetPaths,
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

        // Pool SSOT — checkpoint persists `resolvedAction` but NOT
        // `state.artifacts`. On resume the pool would otherwise be empty,
        // breaking decompose / plan / execute that read the pool. Rebuild
        // it via the single writer (`loadResolvedArtifacts`) so the SSOT
        // invariant (`state.artifacts ⊆ RAC`) is preserved across resume.
        // Truthy-check on `state.artifacts` is the gate that distinguishes
        // jobs with an `artifacts` channel (code/design seed it to `[]`
        // in resolve) from those without one (planner), keeping the
        // partial state emit RAC-bounded per job schema.
        const resumeFeaturePath = resolveFeaturePath(state);
        let resumeArtifacts = state.resolvedArtifacts;
        if ((!resumeArtifacts || resumeArtifacts.length === 0) && resumeFeaturePath) {
          resumeArtifacts = loadResolvedArtifacts(state.resolvedAction, resumeFeaturePath);
        }
        const resumeUpdatedArtifacts = (state as any).artifacts
          ? appendOrUpdatePool((state as any).artifacts, resumeArtifacts || [])
          : undefined;

        emitRACSummary(state.resolvedAction, undefined, state._uiLocale);

        return {
          resolvedAction: state.resolvedAction,
          resolvedArtifacts: resumeArtifacts,
          ...(resumeUpdatedArtifacts !== undefined ? { artifacts: resumeUpdatedArtifacts } : {}),
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
      let slots: { target?: string[]; refs?: string[]; context?: string[]; domain?: import('@ant/shared').Domain };
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

        // dusk-mounding-pilot regression — chat-driven explicit submits
        // (DomainToggle / `@domain:` mention / explicit toggle without
        // ActionConfigView) omit `target` entirely. The FE only fills
        // `target` when ActionConfigView is opened; every other surface
        // expects the BE to mirror the matrix default. Without this
        // fallback, RAC.target is undefined → buildSystemPrompt drops the
        // "Target Path" section → the LLM hallucinates a path
        // (e.g. `architecture/system/main.md`) → the disk writer is gated
        // on `targetRelPath` so the artifact is silently dropped. Mirrors
        // the infer branch's `target: targets ?? ['plan/prd.md']`
        // behaviour through the matrix-defined SSOT instead of an
        // intent-specific hardcode.
        //
        // marble-barking-grass regression — for `target.kind === 'revise'`
        // intents (rev-spec, rev-sys, …), pass `metadata.refs` so the
        // helper can promote the single selected ref to target. Without
        // this, `getDefaultTargetPaths` returned undefined for the revise
        // family and decompose crashed with "requires exactly one target
        // file, got 0".
        const explicitTarget = metadata.target?.length
          ? metadata.target
          : getDefaultTargetPaths(intentId as IntentId, metadata.domain, { refs: metadata.refs });
        if (!metadata.target?.length && explicitTarget?.length) {
          console.log(`⚡ [detect] Explicit: target missing → matrix default ${JSON.stringify(explicitTarget)}`);
        }

        slots = {
          target: explicitTarget,
          refs: metadata.refs,
          context: metadata.context,
          // Phase 1 (10.2): explicit > infer. ActionMetadata.domain set via
          // DomainToggle / `@domain:` mention bypasses LLM inference.
          domain: metadata.domain,
        };
        source = 'explicit';
        basis = metadata.basis;
        console.log(`⚡ [detect] Explicit: intent=${intentId}, domain=${metadata.domain ?? 'unset'}`);

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

        // marble-barking-grass regression — for `target.kind === 'revise'`
        // intents (rev-spec, rev-sys, …), the infer pipeline rarely fills
        // `inferred.target` (the design strategy only populates it for
        // `design-system`; `design-spec` leaves it undefined). Route the
        // merged refs through the matrix SSOT so the single-ref → target
        // promotion stays in one place — same helper, same opts shape as
        // the explicit branch above.
        const mergedTarget = merged.target?.length
          ? merged.target
          : getDefaultTargetPaths(merged.intentId as IntentId, merged.domain, { refs: merged.refs });
        if (!merged.target?.length && mergedTarget?.length) {
          console.log(`📋 [detect] Infer: target missing → matrix default ${JSON.stringify(mergedTarget)}`);
        }

        slots = {
          target: mergedTarget,
          refs: merged.refs,
          context: merged.context,
          domain: merged.domain,
        };
        source = 'infer';
        basis = merged.basis;
        reasoning = inferred.reasoning;

        console.log(`📋 [detect] Infer: intentId=${intentId}`);
      }

      // Phase 1.5: per-domain defaults seed (H-3).
      //
      // When the slot defines `defaults[domain]`, Phase 1 seeds the
      // techTier shape (`stack`, `gameEngine`) before the LLM ever sees
      // the basis. This avoids the situation where game-domain detect
      // produces a `stack: undefined` basis and the LLM has to guess the
      // engine from scratch. User-supplied basis fields always win over
      // the seed.
      basis = applyDomainDefaultsToBasis(intentId, slots.domain, basis);

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

      // Pool writer — single SSOT for `state.artifacts` filling. RAC-resolved
      // artifacts merge into any existing pool entries (intra-job self-output
      // from prior tasks survives via append-or-upsert by path). The
      // truthy-check on `state.artifacts` distinguishes jobs that own a
      // pool channel (code/design seed it to `[]` in resolve) from those
      // that do not (planner), so the partial state emit stays schema-safe
      // per job. See `AGENTS.md` "state.artifacts Post-RAC SSOT".
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
 * Phase 1 H-3 — apply per-domain seed values from `BasisSlotConfig.defaults[domain]`
 * to the (possibly empty) `basis`. User-supplied fields always win; the seed
 * only fills missing slots so wizard / explicit selections are preserved.
 *
 * The canonical use case is game domain ⇒ `stack='frontend'`, `gameEngine='phaser'`.
 * Without this seed, decompose has to guess the engine from scratch and the
 * Phase 2 phaser-host pattern relies on probabilistic LLM inference rather
 * than declarative project metadata.
 */
function applyDomainDefaultsToBasis(
  intentId: string,
  domain: Domain | undefined,
  basis: Basis | undefined,
): Basis | undefined {
  const slot = getConfigSlots(intentId as IntentId)?.basis;
  const lockedStack = slot?.lockedStack;
  const defaults = domain ? slot?.defaults?.[domain] : undefined;

  // Don't touch basis if the slot doesn't opt into techTier — locked
  // stack and per-domain defaults are both techTier-shape concepts.
  if (!slot?.tiers?.includes('techTier')) return basis;

  // Nothing to apply.
  if (!lockedStack && !defaults) return basis;

  const next: Basis = basis ? { ...basis } : {};
  const techTier = next.techTier ? { ...next.techTier } : {};

  // lockedStack overrides any existing / inferred stack regardless of
  // domain. Intent identity (gen-sys-fe / -be / -full) decides the stack;
  // user input cannot drift it because the wizard hides the picker too.
  if (lockedStack) {
    techTier.stack = lockedStack;
  } else if (defaults?.stack && !techTier.stack) {
    techTier.stack = defaults.stack;
  }

  if (defaults?.gameEngine) {
    // gameEngine attaches to the frontend tier (or a single non-backend tier).
    const targetKey = (techTier.stack === 'backend') ? undefined : 'frontend' as const;
    if (targetKey) {
      const existingTier = techTier[targetKey];
      if (existingTier) {
        if (!existingTier.gameEngine) {
          techTier[targetKey] = { ...existingTier, gameEngine: defaults.gameEngine };
        }
      } else {
        techTier[targetKey] = { stack: 'frontend', gameEngine: defaults.gameEngine };
      }
    }
  }
  // Only return new techTier if we actually changed something.
  if (Object.keys(techTier).length === 0) return basis;
  next.techTier = techTier;
  return next;
}

/**
 * Fire-and-forget chat emission for the detect phase. Never awaited so graph
 * execution stays non-blocking; rendering failures surface via emitDetectOutcome's
 * own warn logging (no silent swallow — see AGENTS.md Canonical Tag Rendering SSOT).
 */
function emitRACSummary(
  rac: ResolvedActionContext,
  reasoning: InferredAction['reasoning'] | undefined,
  locale: string | undefined,
): void {
  void emitDetectOutcome(rac, { reasoning, locale, phase: 'detect' });
}
