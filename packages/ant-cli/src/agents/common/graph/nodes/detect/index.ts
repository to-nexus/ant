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

import type { DetectableState, DetectStrategy, DetectAugment, DetectResult } from './types.js';
import type { Basis, InferredAction, IntentId, ResolvedActionContext, Domain } from '@ant/shared';
import {
  resolveToRAC,
  mergeWithMetadata,
  isValidIntentId,
  getConfigSlots,
  getDefaultTargetPaths,
  deriveFromIntent,
} from '@ant/shared';
import type { ChoiceOptions } from '../triage/types.js';
import { loadResolvedArtifacts } from '../../loadDocumentsForRAC.js';
import { getEstimatingLabel, type UILocale } from '../../timing/estimatingLabels.js';
import { extractLLMInfo } from '../../../../../core/ports/workflow.js';
import { appendOrUpdatePool } from '../../../../../core/prompt/builder/ArtifactPipeline.js';
import { emitDetectOutcome, type DetectPathsCompressed } from '../../../../../core/streaming/emitDetectOutcome.js';
import { compressPathsByFolder } from '../../../../../core/context/compressPathsByFolder.js';
import type { FileSystemPort } from '../../../../../core/ports/filesystem.js';
import { inferRacWithTools } from './inferRacWithTools.js';

export { type DetectableState, type DetectStrategy, type DetectResult, type DetectAugment } from './types.js';

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
      // SSOT — `actionMetadata.intent` 가 진실. 세션이 옛 turn 의
      // `resolvedAction.intent` 를 복원했어도 새 turn 의 explicit intent 와
      // 다르면 fast-path 우회 → 아래 explicit/infer 분기에서 새 intent 로
      // RAC 재구성. 같으면 정상 fast-path (continuation).
      const restoredIntent = state.resolvedAction?.intent;
      const newIntent = state.actionMetadata?.intent;
      const intentDiverged = !!newIntent && !!restoredIntent && newIntent !== restoredIntent;
      if (state.resolvedAction && !strategy.isAwaitingInput?.(state) && !intentDiverged) {
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

        emitRACSummary(state.resolvedAction, undefined, state._uiLocale, state.deps?.fileSystem);

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

      if (state.actionMetadata?.intent) {
        // ── Explicit path: SSOT = `actionMetadata.intent` 존재.
        // Triage skip ([triage/index.ts:143]) 와 동일 게이트. `.explicit`
        // boolean 은 BE 가 더 이상 read 하지 않는다 (FE UI badge 잔존).
        // metadata 가 모든 slot 을 제공. No LLM. ──
        const metadata = state.actionMetadata;
        intentId = metadata.intent!;

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
        // 전략별 explicit hook — LLM classify 가 채우던 job-specific state
        // (예: visual 의 assetType / jobMode / executionTier) 를 intent 에서 derive.
        // 다른 잡은 미구현 → no-op.
        inferStateUpdates = strategy.onExplicit?.(state, intentId) as Partial<T> | undefined;
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
      emitRACSummary(resolvedAction, reasoning, state._uiLocale, state.deps?.fileSystem);

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
 *
 * When `fileSystem` is provided, the helper compresses RAC slot paths
 * (target / refs / context) into folder entries where every file in a
 * directory was selected — produces `pathsCompressed` for the chat
 * `<detect>` renderer. fileSystem absence (e.g. tests) degrades to the
 * legacy un-compressed emission.
 */
function emitRACSummary(
  rac: ResolvedActionContext,
  reasoning: InferredAction['reasoning'] | undefined,
  locale: string | undefined,
  fileSystem: FileSystemPort | undefined,
): void {
  void (async () => {
    const pathsCompressed = await buildPathsCompressed(rac, fileSystem);
    await emitDetectOutcome(rac, { reasoning, locale, phase: 'detect', pathsCompressed });
  })();
}

async function buildPathsCompressed(
  rac: ResolvedActionContext,
  fileSystem: FileSystemPort | undefined,
): Promise<DetectPathsCompressed | undefined> {
  if (!fileSystem) return undefined;
  const [target, refs, context] = await Promise.all([
    rac.target?.length ? compressPathsByFolder(rac.target, fileSystem) : Promise.resolve(undefined),
    rac.refs?.length ? compressPathsByFolder(rac.refs, fileSystem) : Promise.resolve(undefined),
    rac.context?.length ? compressPathsByFolder(rac.context, fileSystem) : Promise.resolve(undefined),
  ]);
  if (!target && !refs && !context) return undefined;
  return { target, refs, context };
}

/**
 * Choice options for an agent/job switch — the resolved intent belongs to a
 * different agent/job than the one currently selected. Only switch / dismiss:
 * "proceed here" is meaningless when the current job cannot produce this
 * artifact, and (until the toolbar selects intents directly) there is no
 * well-defined in-job intent to fall back to.
 */
function buildAgentJobSwitchChoice(): ChoiceOptions {
  return {
    positive: { label: '전환', action: 'redirect' },
    negative: { label: '취소', action: 'dismiss' },
  };
}

/**
 * DetectResult for the agent/job-switch gate. Reuses the `redirect-suggested`
 * surface so the existing Phase 4 card-render + `routeAfterDetect → __end__`
 * pause path applies unchanged. The single suggested alternative is the
 * resolved intent itself — run in its correct agent/job after the user
 * confirms the switch.
 */
function buildAgentJobSwitchResult<T extends DetectableState>(
  intentId: IntentId,
  want: { agent: string; jobType: string },
  state: T,
): DetectResult<T> {
  return {
    status: 'redirect-suggested',
    suggestedAlternatives: [
      { intentId, reason: `${want.agent}/${want.jobType}에서 처리되는 작업입니다.` },
    ],
    choiceOptions: buildAgentJobSwitchChoice(),
    displayMessage: `요청이 현재 ${state.currentJob} 작업 범위를 벗어납니다. ${want.agent}/${want.jobType}(으)로 전환할까요?`,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// createInferDetectNode — Phase D SSOT (job-blind tool-use + augment hook)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Job-blind detect factory — consumes `state.triageResult.resolvedIntentId`
 * (or `actionMetadata.intent` on the explicit path) and runs the unified
 * tool-use RAC inference via `inferRacWithTools`. An optional `augment` hook
 * lets jobs add post-infer state (e.g. planner-plan `executionTier`, design
 * Figma reachability) without re-classifying intent or re-loading artifacts.
 *
 * Replaces the per-job `createDetectNode(strategy)` wiring for code / design
 * / plan. Visual keeps `createDetectNode(visualDetectStrategy)` because its
 * "detect" classifies asset type — orthogonal to the matrix slot resolution
 * this factory implements.
 */
export function createInferDetectNode<T extends DetectableState>(
  augment?: DetectAugment<T>,
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
      // ── Phase 0: Resume fast path (preserved escalation reuse) ──
      // SSOT — 새 turn 의 explicit intent 가 복원된 옛 intent 와 다르면 우회.
      // Phase 1 의 explicit 분기에서 새 intent 로 RAC 재구성. 같으면 정상 fast-path.
      const restoredIntentInfer = state.resolvedAction?.intent;
      const newIntentInfer = state.actionMetadata?.intent;
      const intentDivergedInfer = !!newIntentInfer && !!restoredIntentInfer && newIntentInfer !== restoredIntentInfer;
      if (state.resolvedAction && !intentDivergedInfer) {
        console.log(`🔍 [detect:infer] Resume — using existing resolvedAction (LLM skip)`);
        const resumeFeaturePath = resolveFeaturePath(state);
        let resumeArtifacts = state.resolvedArtifacts;
        if ((!resumeArtifacts || resumeArtifacts.length === 0) && resumeFeaturePath) {
          resumeArtifacts = loadResolvedArtifacts(state.resolvedAction, resumeFeaturePath);
        }
        const resumeUpdatedArtifacts = (state as any).artifacts
          ? appendOrUpdatePool((state as any).artifacts, resumeArtifacts || [])
          : undefined;
        emitRACSummary(state.resolvedAction, undefined, state._uiLocale, state.deps?.fileSystem);
        return {
          resolvedAction: state.resolvedAction,
          resolvedArtifacts: resumeArtifacts,
          ...(resumeUpdatedArtifacts !== undefined ? { artifacts: resumeUpdatedArtifacts } : {}),
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
        } as unknown as Partial<T>;
      }

      // ── Phase 1: Resolve intentId source ──
      // SSOT — `actionMetadata.intent` (사용자가 explicit 하게 고른 값) 이
      // 있으면 그것을, 없으면 triage 가 LLM 으로 결정한 값을 사용. Triage 의
      // skip 게이트 ([triage/index.ts:143]) 와 같은 진실 ([actionMetadata.intent] 존재).
      const intentId = state.actionMetadata?.intent ?? state.triageResult?.resolvedIntentId;
      if (!intentId) {
        throw new Error(
          '[detect:infer] No intentId — triage.resolvedIntentId and actionMetadata.intent both missing',
        );
      }
      if (!isValidIntentId(intentId)) {
        throw new Error(`[detect:infer] Invalid intentId: "${intentId}"`);
      }

      const domain = state.triageResult?.domain ?? state.actionMetadata?.domain;
      const featurePath = resolveFeaturePath(state);

      // ── Phase 2: Build DetectResult ──
      let detectResult: DetectResult<T>;
      if (state.actionMetadata?.intent) {
        // Explicit path — SSOT = `actionMetadata.intent` 존재. metadata 가
        // 권위. No tool-loop, no progressibility check.
        const metadata = state.actionMetadata;
        const explicitTarget = metadata.target?.length
          ? metadata.target
          : getDefaultTargetPaths(intentId as IntentId, metadata.domain, { refs: metadata.refs });
        const basis = applyDomainDefaultsToBasis(intentId, metadata.domain, metadata.basis);
        const resolvedAction = resolveToRAC(
          intentId as IntentId,
          {
            target: explicitTarget,
            refs: metadata.refs,
            context: metadata.context,
            domain: metadata.domain,
          },
          'explicit',
          basis,
        );
        const artifacts = featurePath ? loadResolvedArtifacts(resolvedAction, featurePath) : [];
        detectResult = {
          status: 'proceed',
          resolvedAction,
          artifacts,
        };
        console.log(`⚡ [detect:infer] Explicit: intent=${intentId}, domain=${metadata.domain ?? 'unset'}`);
      } else {
        // ── Agent/job-switch gate ──
        // The resolved intent must belong to the currently selected
        // agent/job. If it crosses that boundary, do NOT silently run it
        // here (which would build tasks for another job's intent while the
        // toolbar stays put). Surface a switch choice card and pause; the
        // user confirms before we hand off to the correct agent/job.
        const want =
          state.currentAgent && state.currentJob
            ? deriveFromIntent(intentId as IntentId)
            : undefined;
        if (want && (want.agent !== state.currentAgent || want.jobType !== state.currentJob)) {
          console.log(
            `🔀 [detect:infer] Cross-job intent — resolved=${intentId} → ${want.agent}/${want.jobType}, ` +
              `current=${state.currentAgent}/${state.currentJob}; offering switch`,
          );
          detectResult = buildAgentJobSwitchResult(intentId as IntentId, want, state);
        } else {
          // Infer path — job-blind tool-use loop. LLM / promptBuilder /
          // fileSystem 의존성 검증은 이 분기 안에서만 — explicit branch 는
          // LLM 불필요. fileSystem 가드는 navy-keeping-polar 회귀 방지:
          // 누락 시 pathResolver.getRootPath() 가 익명 TypeError 로 죽지 않고
          // DI 결손을 명시적으로 surface 한다.
          const llm = state.deps?.llm;
          const promptBuilder = state.deps?.promptBuilder;
          const fileSystem = state.deps?.fileSystem;
          if (!llm) throw new Error('[detect:infer] LLM not available');
          if (!promptBuilder) throw new Error('[detect:infer] PromptBuilder not available');
          if (!fileSystem) throw new Error('[detect:infer] FileSystemPort not available — orchestrator must inject state.deps.fileSystem for any agent using createInferDetectNode');
          const inferred = await inferRacWithTools({
            intentId: intentId as IntentId,
            domain,
            workspaceState: state.workspaceState,
            featureContext: (state as any).featureContext,
            featurePath,
            fileSystem,
            command: state.deps?.command,
            llm,
            promptBuilder,
            locale: state._uiLocale,
          });
          detectResult = inferred as DetectResult<T>;
        }
      }

      // ── Phase 3: Augment hook (job-specific post-infer) ──
      if (augment) {
        const aug = await augment({
          intentId: intentId as IntentId,
          detectResult,
          state,
        });
        detectResult = {
          ...detectResult,
          ...aug,
          stateUpdates: {
            ...(detectResult.stateUpdates || {}),
            ...(aug.stateUpdates || {}),
          } as Partial<T>,
        };
      }

      // ── Phase 4: Commit ──
      // No `state.detect` channel — would shadow the `detect` node name; the
      // outcome lives on `state.resolvedAction` (DetectableFields SSOT).
      const baseReturn: Record<string, any> = {
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        _phaseTimings: { ...(state._phaseTimings || {}), detect: Date.now() - phaseStart },
        ...(detectResult.stateUpdates || {}),
      };

      if (detectResult.status === 'proceed' && detectResult.resolvedAction) {
        const resolvedAction = detectResult.resolvedAction;
        const resolvedArtifacts = detectResult.artifacts ?? [];
        emitRACSummary(resolvedAction, undefined, state._uiLocale, state.deps?.fileSystem);
        const updatedArtifacts = (state as any).artifacts
          ? appendOrUpdatePool((state as any).artifacts, resolvedArtifacts)
          : undefined;
        return {
          ...baseReturn,
          resolvedAction,
          resolvedArtifacts,
          ...(updatedArtifacts !== undefined ? { artifacts: updatedArtifacts } : {}),
          tokenUsage: state.tokenUsage,
        } as unknown as Partial<T>;
      }

      // blocked / redirect-suggested — surface display message + choice
      // card via the chat adapter so the FE renders the UI even when the
      // graph ends immediately.
      if (detectResult.displayMessage) {
        try {
          const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient.js');
          const chatAPI = getChatAPIClient();
          await chatAPI.startMessage();
          if (detectResult.status === 'redirect-suggested' && detectResult.choiceOptions) {
            const altIntent = detectResult.suggestedAlternatives?.[0]?.intentId;
            // The alternative is an intent id; the switch target's agent/job
            // is derived from it (matrix SSOT), and the intent itself is
            // carried so the target runs exactly it (no re-inference drift).
            const target = altIntent ? deriveFromIntent(altIntent) : undefined;
            const envelope = {
              resolvedIntentId: state.triageResult?.resolvedIntentId,
              group: 'work' as const,
              mode: state.triageResult?.mode,
              domain: state.triageResult?.domain,
              displayMessage: detectResult.displayMessage,
              choiceOptions: detectResult.choiceOptions,
              suggestedAgent: target?.agent,
              suggestedJob: target?.jobType,
              switchIntentId: altIntent,
            };
            await chatAPI.sendTriageChoice(
              detectResult.displayMessage,
              state._httpJobId || 'unknown',
              detectResult.choiceOptions,
              envelope,
              state.overrideDirective || state.directive || '',
            );
          } else {
            await chatAPI.sendLLMEvent({ type: 'text', text: detectResult.displayMessage });
          }
          await chatAPI.finalizeMessage();
        } catch (chatError) {
          console.warn('[detect:infer] Failed to send blocked/redirect chat message:', chatError);
        }
      }

      console.log(`🚫 [detect:infer] status=${detectResult.status} intent=${intentId}`);
      return {
        ...baseReturn,
        tokenUsage: state.tokenUsage,
      } as unknown as Partial<T>;
    } finally {
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'detect', 0);
      }
    }
  };
}
