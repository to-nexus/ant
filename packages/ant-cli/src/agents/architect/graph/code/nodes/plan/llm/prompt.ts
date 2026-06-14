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
import { CodeTask, FeatureCodeTask } from "../../../../../types/task";
import { getTechTier, type ResolvedArtifact } from "@ant/shared";
import { AutoInjectionResolver } from "../../../../../../../core/prompt/builder/AutoInjectionResolver";
import { TEMPLATE_PATHS } from "../../../../../../../core/prompt/builder/templatePaths";
import {
  isServiceVirtualizationContractActive,
  isServiceVirtualizationDataActive,
  isServiceVirtualizationImageryActive,
  isServiceVirtualizationSessionActive,
  isSvWorldSeedActive,
  isSvStoreLifecycleActive,
  isSvBodyLifecycleActive,
  isSvAuthFlowActive,
} from "../../../../../../../core/prompt/builder/serviceVirtualization";
import { isAuthSessionLifecycleActive } from "../../../../../../../core/prompt/builder/authSessionGate";
import { resolveArtifacts, ArtifactPoolView } from "../../../../../../../core/prompt/builder/ArtifactPipeline";
import { loadAntrules } from "../../../../../../../core/artifact/antrules";
import { getRACDocuments } from "@ant/shared";
import { hooksForTaskType } from "../../../tasks/_shared/registry";
import { toPlanPromptResult, type PlanPromptCtx } from "../../../tasks/_shared/types";
import { formatCodeContext } from "../../../tasks/_shared/helpers/planPrompt";
import { renderPriorCompletedFiles } from "../../../tasks/_shared/helpers/priorCompletedFiles";
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

  // Single per-task injection SSOT — `task.include` only. The legacy explicit
  // full-RAC bypass (which reused `resolvedAction.documents` for explicit
  // pipelines and skipped per-task narrowing) is removed so both pipelines
  // narrow identically. Pool doc not pre-injected here is reachable on-demand
  // via RAC-scoped reads (the code `tool` node gate).
  let resolvedActionWithDocs = state.resolvedAction;
  const planDocs: ResolvedArtifact[] = resolveArtifacts(pool,
    { taskType: task.type, include: task.include },
    { threshold: 30_000 });

  if (planDocs.length > 0) {
    resolvedActionWithDocs = {
      ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
      artifacts: planDocs,
      documents: planDocs,
    };
    const totalChars = planDocs.reduce((s, a) => s + (a.content?.length || 0), 0);
    console.log(`📄 [Plan] ${pool.length} pool → ${planDocs.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(task.include ?? [])})`);
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

  // Parent-pre-plan shape SSOT — type-based, regex-free.
  // - slice declaration: feature / ui / design-system / test-code each receive
  //   the parent's slice (`task.goal` + `slice` rationale + optional create[]
  //   manifest). All four author / refine their own implementation block.
  // - diagnostic carry: error sub-task receives a per-root-cause manifest
  //   from the verification parent (separate `apply-mode` semantic).
  // - cross-batch contracts: only feature/ui/design-system siblings actually
  //   share runtime contracts (export names / shared types). test-code
  //   siblings write disjoint test files; verification mandate against
  //   sibling-output is unsatisfiable there and must be silenced.
  const isSliceDeclaration = hasPrePlanText && (
    task.type === 'feature' ||
    task.type === 'ui' ||
    task.type === 'design-system' ||
    task.type === 'test-code' ||
    // seam (reference-closure) parent fans out slim slices; each child re-plans
    // its slice over the materialized code. Same slim-shape contract as feature.
    task.type === 'seam'
  );
  const isDiagnosticCarry = hasPrePlanText && task.type === 'error';
  const hasCrossBatchContracts = hasPrePlanText && (
    task.type === 'feature' ||
    task.type === 'ui' ||
    task.type === 'design-system' ||
    // seam slices share the module's reference graph (which destination each
    // slice conforms to) — a genuine cross-batch contract.
    task.type === 'seam'
  );
  const batchSplitCount = (task as CodeTask).batchSplitCount ?? 0;

  // FeatureTask sub-classification — surfaces the parent's `band` to the
  // self plan LLM so band-conditional rules in `plan/rules.md` (entry-point
  // ownership, integration-vs-foundation responsibilities) can dispatch
  // correctly. Non-feature task types do not carry a band; the template
  // defaults to the foundation/no-band branch in that case.
  const taskBand = task.type === 'feature' ? (task as FeatureCodeTask).band : undefined;
  const prompt = await promptBuilder.render(TEMPLATE_PATHS.codePlanDefault.base, {
    taskName: task.name, taskDescription: task.description,
    directive: state.directive || '', taskType: task.type, taskBand,
    // Response-language SSOT — gated `jobs/code/base/injections/response-language`
    // partial is included at the top of `plan/base.md`; this var is what
    // makes the gate evaluate against the user's detected language so
    // batch-split sub-task `name` / `rationale` come out in the user's
    // language instead of being silently overridden to English by the
    // legacy directive in `jobs/code/base/system.md`.
    userLanguage: state.context?.userLanguage || 'en',
    prePlanText: hasPrePlanText ? prePlanTextRaw : '',
    hasPrePlanText,
    isSliceDeclaration,
    // Seam partial: gates the plan-only "enumerate & partition" / "this is one
    // slice" blocks. True at plan time so the parent (isSliceDeclaration=false)
    // enumerates the module and emits batches, while a slice child
    // (isSliceDeclaration=true) is told NOT to re-partition. At execute time the
    // partial renders only its remediation principles (seamPlanning omitted).
    seamPlanning: true,
    isDiagnosticCarry,
    hasCrossBatchContracts,
    batchSplitCount,
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
    // Cross-task output manifest — files prior tasks in this job already
    // authored (paths only). Closes the forward-visibility gap that let a
    // feature task re-seed/re-create what a foundation/platform owner already
    // produced. Bodies are read on-demand via the RAC-orthogonal codebase
    // path; this only announces existence. See `priorCompletedFiles.ts`.
    priorCompletedFiles: renderPriorCompletedFiles(state, task),
    // Service Virtualization gates (SBS) — four orthogonal partials
    // (contract / data / imagery / session). `hasBusinessConnection` is
    // derived once at resolve and parked on `state.virtualizationSnapshot`.
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
    // Session partial split into four blocks (band → world-seed +
    // store-lifecycle [store OWNER], renderable → body-lifecycle [read
    // consumer], taskType → auth-flow narrowed in-body). Store-lifecycle
    // (write-path / single instance) gates on the owner, not the renderable
    // consumer — see `serviceVirtualization/sessionGate.ts`.
    serviceVirtualizationSessionActive: isServiceVirtualizationSessionActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      taskType: task.type,
      band: taskBand,
      renderable: (task as { renderable?: boolean }).renderable,
    }),
    svWorldSeedActive: isSvWorldSeedActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      taskType: task.type,
      band: taskBand,
    }),
    svStoreLifecycleActive: isSvStoreLifecycleActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      taskType: task.type,
      band: taskBand,
    }),
    svBodyLifecycleActive: isSvBodyLifecycleActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      renderable: (task as { renderable?: boolean }).renderable,
    }),
    svAuthFlowActive: isSvAuthFlowActive({
      hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      taskType: task.type,
    }),
    // Session-lifecycle completeness — SV-INDEPENDENT (no hasBusinessConnection
    // precondition): persist+rehydrate round-trip is true production behavior,
    // owned by the platform-band session boundary. See `authSessionGate.ts`.
    authSessionLifecycleActive: isAuthSessionLifecycleActive({
      taskType: task.type,
      band: taskBand,
    }),
    // Plan-tool-loop budget surfacing — observable signal for
    // `plan-tools-batch.md`'s Finalization Discipline. Derived from
    // LangGraph's per-worker recursionLimit; default 200 mirrors the
    // env-default in `runner.ts` so the variable is never undefined.
    remainingRecursionBudget: Math.max(
      0,
      (state.recursionLimit ?? 200) - (state.recursionCount ?? 0),
    ),
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
