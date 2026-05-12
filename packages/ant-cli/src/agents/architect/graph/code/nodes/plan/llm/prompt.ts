/**
 * Plan prompt builders.
 *
 * - `buildPlanPrompt` (private to this folder) renders a single string
 *   prompt for `generatePlanText` (single-shot, no tools).
 * - `buildPlanPromptBlocks` (public) renders a list of `TextContentBlock`
 *   for the plan-with-tools path so Anthropic prompt caching can split
 *   the stable design-doc payload into its own cached block.
 *
 * Dispatch order (T6b-β):
 *   1. `hooks.plan.buildPrompt(ctx)` — full override; used by verification
 *      and error which render against dedicated `jobs/code/nodes/plan/
 *      variants/{type}/base` templates.
 *   2. Generic `jobs/code/nodes/plan/base` path — artifact pipeline, RAC
 *      documents, basis section. Task types that only need to inject extra
 *      template vars (e.g. setup's `setupConstraints`) participate via
 *      `hooks.plan.extraTemplateVars(ctx)`.
 *
 * The phase layer itself is blind to `task.type`; all branching has moved
 * into `tasks/{type}/hooks/plan.ts`.
 */

import { TextContentBlock } from "../../../../../../../core/ports/llm";
import { ArchitectGraphState } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { getTechTier, type ResolvedArtifact } from "@ant/shared";
import { AutoInjectionResolver } from "../../../../../../../core/prompt/builder/AutoInjectionResolver";
import {
  isServiceVirtualizationContractActive,
  isServiceVirtualizationDataActive,
  isServiceVirtualizationImageryActive,
} from "../../../../../../../core/prompt/builder/serviceVirtualization";
import { resolveArtifacts, ArtifactPoolView } from "../../../../../../../core/prompt/builder/ArtifactPipeline";
import { loadAntrules } from "../../../../../../../core/artifact/antrules";
import { getRACDocuments } from "@ant/shared";
import { hooksForTaskType } from "../../../tasks/_shared/registry";
import { toPlanPromptResult, type PlanPromptCtx } from "../../../tasks/_shared/types";
import { formatCodeContext } from "../../../tasks/_shared/helpers/planPrompt";
import { activePlanBuildPrompt } from "../../../tasks/_shared/verify/activeHooks";

export interface BuildPlanPromptResult {
  prompt: string;
  /**
   * Variant-specific variable snapshot contributed by
   * `hooksForTaskType(task.type).plan.buildPrompt`. Empty `{}` for the generic
   * path. Merged into `logPrompt`'s `injectedVariables` so debug logs surface
   * hook-injected variables (verification's `dependencyStatusKind`,
   * `cachedPassedStepsCount`, etc.) that phase code can't see directly.
   */
  vars: Record<string, unknown>;
}

export async function buildPlanPrompt(
  state: ArchitectGraphState,
  task: CodeTask,
  codeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<BuildPlanPromptResult> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Plan] PromptBuilder not available');

  const planHook = hooksForTaskType(task.type)?.plan;
  // Loaded once per plan render so every hook consumes the same snapshot.
  const antrulesContent = loadAntrules(state.context?.featurePath);
  const promptCtx: PlanPromptCtx = {
    state,
    task,
    codeContext,
    violationsText,
    uiDoc,
    remainingTasks,
    options,
    antrulesContent,
  };

  // Phase-mode dispatch SSOT — `activePlanBuildPrompt` returns the
  // verify-mode shared builder when the task has entered verify-mode
  // and the bundle's apply-phase `buildPrompt` (e.g. error variant)
  // otherwise. `undefined` falls through to the generic plan base
  // path. Phase code never inspects `_verifyEntered`.
  const activeBuilder = activePlanBuildPrompt(state);
  if (activeBuilder) {
    const result = toPlanPromptResult(await activeBuilder(promptCtx));
    return { prompt: result.text, vars: result.vars ?? {} };
  }

  // Generic path — artifact pipeline + RAC docs + optional extra template vars.
  // Spec-driven = a spec artifact is present with role='ref' (RAC-derived).
  const pool = state.artifacts || [];
  const isSpecDriven = new ArtifactPoolView(pool).activeSpecRefFilename() !== null;
  const hasExplicitDocs = state.resolvedAction?.source === 'explicit'
    && ((state.resolvedAction?.artifacts?.length ?? state.resolvedAction?.documents?.length ?? 0) > 0);

  let planDocs: ResolvedArtifact[] = [];
  let resolvedActionWithDocs = state.resolvedAction;
  if (!hasExplicitDocs) {
    planDocs = resolveArtifacts(pool,
      { taskType: task.type, include: task.include },
      { threshold: 30_000 });

    if (planDocs.length > 0) {
      resolvedActionWithDocs = {
        ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        artifacts: planDocs,
        documents: planDocs,
      };
      const totalChars = planDocs.reduce((s, a) => s + (a.content?.length || 0), 0);
      console.log(`📄 [Plan] Pipeline: ${pool.length} pool → ${planDocs.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(task.include ?? 'default')})`);
    }
  }

  const taskTechTiers = task.techTiers?.length ? task.techTiers : (getTechTier(state) ? [getTechTier(state)!] : []);
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);
  const fmtCtx = formatCodeContext(codeContext);

  const _planBasis = state.resolvedAction?.basis;
  if (!_planBasis) {
    console.warn(`⚠️  [Plan] state.resolvedAction.basis is ${_planBasis === undefined ? 'undefined' : 'falsy'} (resolvedAction exists: ${!!state.resolvedAction}, intent: ${state.resolvedAction?.intent})`);
  } else {
    console.log(`📐 [Plan] basis present: stack=${_planBasis.techTier?.stack || 'none'}, visualTier=${_planBasis.visualTier ? Object.keys(_planBasis.visualTier).join(',') : 'none'}`);
  }
  // Phase 1: thread domain + slot so the matrix gate (`isTierActive`) is
  // honoured. Without these the legacy permissive path renders every tier
  // with data — fine for the existing service flow but bypasses the
  // domain × tier policy for game/* and any future-domain extensions.
  const _slot = state.resolvedAction?.intent
    ? (await import('@ant/shared')).getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
    state.resolvedAction?.domain,
    _slot,
  );

  // Post-RAC template flags — see `AGENTS.md`
  // "Post-RAC Template Condition SSOT" for the 3-category semantics.
  //
  // Under the 3-axis role model (Authority / Edit-scope / Task-scope),
  // both `ref` and `context` are authoritative inputs, and the
  // "API Contract IMMUTABLE" directive applies whenever a system-design
  // doc is present — regardless of whether it is injected via ref or
  // context. Gate (`hasSystemDesign`) is therefore the correct flag for
  // the plan/base.md IMMUTABLE notice, not the old role-scoped
  // `hasSystemDesignRef` (which would have silently skipped gen-code-spec
  // / rev-code, where sys-design arrives as context).
  //
  //   `hasSystemDesign` (Gate): gates the "API Contract IMMUTABLE" notice.
  //   `hasUi`           (Gate): gates design-system TOKEN INVENTORY / ui
  //                              ASSET INVENTORY / LAYOUT SPECS in
  //                              plan/rules.md.
  const allDocs = getRACDocuments(resolvedActionWithDocs);
  const planPool = new ArtifactPoolView(allDocs);
  const hasSystemDesign = planPool.hasSystemDesign();
  const hasUi = planPool.hasUi();
  // `uiSource` — Contract-flavoured discriminator; plan/rules.md dispatches
  // the TOKEN/ASSET/LAYOUT inventory branch to the correct per-source
  // template. Hard-exclusive by construction (throws on mixed sources).
  const uiSource = planPool.uiSource();

  // Per-type contributions (e.g. setup → { setupConstraints, hasSetupConstraints }).
  const typeVars = (await planHook?.extraTemplateVars?.(promptCtx)) ?? {};

  // prePlanText surfacing — for batch-split sub-tasks the parent's pre-plan
  // is rendered as plan-tool-loop INPUT (NOT the planText itself; that's
  // the LLM's output). See
  // `nodes/plan/injections/parent-pre-plan.md` for the FPOP-compliant
  // guidance the LLM receives. Identity-shortcut (state.planText :=
  // prePlanText, no LLM) is reserved for `error` task type — see
  // `nodes/plan/shortcut/prePlanned.ts`.
  const prePlanTextRaw = (task as CodeTask).prePlanText;
  const hasPrePlanText = typeof prePlanTextRaw === 'string' && prePlanTextRaw.length > 50;

  const prompt = await promptBuilder.render('jobs/code/nodes/plan/base', {
    taskName: task.name, taskDescription: task.description,
    directive: state.directive || '', taskType: task.type,
    // Response-language SSOT — gated `jobs/code/base/injections/response-language`
    // partial is included at the top of `plan/base.md`; this var is what
    // makes the gate evaluate against the user's detected language so
    // batch-split sub-task `name` / `rationale` come out in the user's
    // language instead of being silently overridden to English by the
    // legacy directive in `jobs/code/base/system.md`.
    userLanguage: state.context?.userLanguage || 'en',
    prePlanText: hasPrePlanText ? prePlanTextRaw : '',
    hasPrePlanText,
    documents: planDocs, hasDocuments: allDocs.length > 0,
    isSpecDriven: isSpecDriven || false,
    projectCodeContext: fmtCtx, directoryTree: codeContext?.directoryTree || '',
    hasProjectCodeContext: !!fmtCtx,
    violationsText, isRetry: !!violationsText,
    remainingTasks, hasRemainingTasks: remainingTasks && remainingTasks.length > 0,
    hasTools: options?.hasTools ?? false,
    resolvedAction: resolvedActionWithDocs, hasSystemDesign, hasUi, uiSource,
    featureContext: state.featureContext,
    antrulesContent,
    hasFrontend, hasBackend,
    // Tier 3 cross-task analysis brief — sealed by Decompose; renders
    // job-level macro goal / cross-cutting concerns / decomposition
    // rationale / (error case) diagnosis + solution direction. Consumed
    // by `templates/jobs/code/nodes/plan/injections/analysis-block.md`
    // (gated `{{#if hasAnalysis}}`). Forbidden at Tier 4; absent at
    // Tier 0/1/2 — those rows leave the block silently empty.
    analysis: state.analysis ?? '',
    hasAnalysis: !!state.analysis,
    // Service Virtualization gates (SBS) — three orthogonal partials
    // (contract / data / imagery). `hasBusinessConnection` is derived
    // once at resolve and parked on `state.virtualizationSnapshot`.
    // See `core/prompt/builder/serviceVirtualization/`.
    serviceVirtualizationContractActive: isServiceVirtualizationContractActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
    }),
    serviceVirtualizationDataActive: isServiceVirtualizationDataActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      taskType: task.type,
    }),
    serviceVirtualizationImageryActive: isServiceVirtualizationImageryActive({
      hasFrontend,
      domain: state.resolvedAction?.domain,
      taskType: task.type,
    }),
    ...typeVars,
  });

  const composed = basisSection ? `${basisSection}\n\n---\n\n${prompt}` : prompt;
  // Plan-node retry loop carries `BatchSplitSchemaViolation` framing on
  // `state._batchSplitViolationFraming` between attempts (mirrors decompose's
  // `prompts.user += buildExecutionTierViolationFraming(e)` pattern). The
  // framing names the violating entry kind/index/field so the next attempt
  // can correct the schema deviation. See state.ts for lifecycle.
  const violationFraming = state._batchSplitViolationFraming;
  const composedWithFraming = violationFraming ? `${composed}\n\n${violationFraming}` : composed;
  return { prompt: composedWithFraming, vars: typeVars };
}

/**
 * Build plan prompt as CacheableContent blocks for Anthropic prompt caching.
 *
 * The designDoc (typically 36K-126K chars) is stable within a plan-toolLoop
 * session, so placing it in a separate block with cache_control enables
 * Anthropic to cache it across successive tool-loop rounds.
 *
 * Used only by the plan-with-tools path (plan-toolLoop). The generatePlanText
 * path (single-shot, no tools) continues to use buildPlanPrompt directly.
 */
export interface BuildPlanPromptBlocksResult {
  blocks: TextContentBlock[];
  /** Hook-contributed template var snapshot; see `BuildPlanPromptResult.vars`. */
  vars: Record<string, unknown>;
}

export async function buildPlanPromptBlocks(
  state: ArchitectGraphState,
  task: CodeTask,
  codeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<BuildPlanPromptBlocksResult> {
  const { prompt: fullPrompt, vars } = await buildPlanPrompt(state, task, codeContext, violationsText, uiDoc, remainingTasks, options);

  // Cache split: use the SAME compacted artifacts that buildPlanPrompt rendered
  // into fullPrompt. Using un-compacted originals would cause replace() mismatches.
  const pipelineArtifacts = resolveArtifacts(state.artifacts || [],
    { taskType: task.type, include: task.include },
    { threshold: 30_000 });
  const artifactContents = pipelineArtifacts
    .filter(a => a.content && a.content.length > 0)
    .map(a => a.content);
  const totalDocSize = artifactContents.reduce((sum, c) => sum + c.length, 0);

  const blocks: TextContentBlock[] = [];

  if (totalDocSize > 3000) {
    const combinedDocs = artifactContents.join('\n\n---\n\n');
    blocks.push({
      type: 'text',
      text: combinedDocs,
      cache_control: { type: 'ephemeral' },
    });
    let promptWithoutDocs = fullPrompt;
    for (const content of artifactContents) {
      promptWithoutDocs = promptWithoutDocs.replace(content, '[See document in previous block]');
    }
    blocks.push({
      type: 'text',
      text: promptWithoutDocs,
    });
    console.log(`🔥 [Plan] Split prompt into cached documents (${totalDocSize} chars) + prompt (${promptWithoutDocs.length} chars)`);
  } else {
    blocks.push({
      type: 'text',
      text: fullPrompt,
      cache_control: { type: 'ephemeral' },
    });
  }

  return { blocks, vars };
}
