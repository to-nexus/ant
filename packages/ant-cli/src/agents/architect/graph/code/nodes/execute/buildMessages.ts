/**
 * buildMessages — Execute-node message composer.
 *
 * Per-node prompt orchestration adapter that wraps the canonical
 * `core/prompt/builder/PromptBuilder`. This file does NOT implement a
 * parallel PromptBuilder; it pre-formats execute-specific inputs
 * (artifact selection, runtime context, UI images, foundation contract,
 * schema anchor), invokes `state.deps.promptBuilder.build(config)`, then
 * post-processes the result into Anthropic cache blocks and composes the
 * final messages against the conversation history.
 *
 * Supports Anthropic Prompt Caching for cost reduction:
 * - System prompts, rules, profiles (cached)
 * - Project context, design docs (cached)
 * - Current task, user directive (not cached - changes frequently)
 */

import { createHash } from "crypto";
import { ArchitectGraphState } from "../../state";
import type { CodeTask } from "../../../../types/task";
import type { BaseTask, FeatureTask } from "@ant/shared";
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { extractLLMInfo } from "../../../../../../core/ports/workflow";
import { formatViolations } from "../../utils/violationFormatter";
import { CacheableContent, MessageContentBlock } from "../../../../../../core/ports/llm";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { getExecutionLogger } from "../../../../../../core/utils/executionLogger";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { detectImageMimeFromBuffer, type AnthropicImageMime } from "../../../../../../core/utils/imageMime";
import { cleanFileContentFromResponse } from "../../utils/responseCleaners";
import { selectArtifacts, compactArtifacts, ArtifactPoolView } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { effectiveTechTier, getTechTier, getRACDocuments, getModelContextWindow, type ResolvedArtifact } from "@ant/shared";
import { deriveArtifactPolicies } from "../../../../../../core/prompt/builder/ArtifactRoleResolver";
import { AutoInjectionResolver } from "../../../../../../core/prompt/builder/AutoInjectionResolver";
import {
  isServiceVirtualizationContractActive,
  isServiceVirtualizationDataActive,
  isServiceVirtualizationImageryActive,
  isServiceVirtualizationSessionActive,
  isSvWorldSeedActive,
  isSvBodyLifecycleActive,
  isSvAuthFlowActive,
} from "../../../../../../core/prompt/builder/serviceVirtualization";
import type { PromptBuildConfig } from "../../../../../../core/prompt/builder/PromptBuildConfig";
import { buildCacheableBlocks } from "../../../../../../core/prompt/builder/CacheBlockMapper";
import { composeMessages } from "../../../../../../core/utils/messageComposer";
import { activeExecuteHook } from "../../tasks/_shared/verify/activeHooks";
import { hooksForTaskType } from "../../tasks/_shared/registry";
import { renderPriorCompletedFiles } from "../../tasks/_shared/helpers/priorCompletedFiles";
import type { TaskType } from "@ant/shared";
import { loadAntrules } from "../../../../../../core/artifact/antrules";
import { normalizeToCodebasePath } from "../../../../../../core/utils/pathNormalizer";
import { containsRuntimeErrorPattern } from "../../../../../../core/utils/runtimeErrorPattern";
import { resolveCodebaseRel } from "./codebaseRel";
import { TEMPLATE_PATHS } from "../../../../../../core/prompt/builder/templatePaths";

const DEFAULT_EXECUTE_TEMPLATES = {
  base: TEMPLATE_PATHS.codeExecuteDefault.base,
  rules: TEMPLATE_PATHS.codeExecuteDefault.rules!,
} as const;

const DEFAULT_PLAN_FRAMING = {
  label: '📋 IMPLEMENTATION PLAN (Structured JSON - FOLLOW EXACTLY)',
  description:
    'The following JSON contains the exact implementation instructions.\n' +
    '- `create`: Files to create with integration points. Import paths and observed API signatures of design-prescribed dependencies are inlined in each entry\'s `purpose`.\n' +
    '- `modify`: Files to modify with specific changes. Dependency signatures relevant to the change are inlined in `changes`.\n' +
    '- `assets`: Asset copy operations (source → destination)',
} as const;

let _lastCacheBlockHashes: { block1?: string; block2?: string; taskId?: string } = {};

/**
 * Dispatch a per-task classifier flag through the bundle's `classify`
 * function. Mirrors `schedClassify` in `parallel/TaskOrchestrator.ts`.
 * Used for the foundation-contract injection (`isFoundation`) and the
 * final-verification template gate (`isFinal`) — Three-Axis SSOT, the
 * bundle owns "my band means scheduling role X".
 */
function schedClassify(
  task: CodeTask | null | undefined,
  flag: 'isFoundation' | 'isFinal',
): boolean {
  if (!task || !task.type) return false;
  const classify = hooksForTaskType(task.type as TaskType)?.scheduling?.classify;
  if (!classify) return false;
  return !!classify(task as BaseTask)[flag];
}

/**
 * Observe `codebase/node_modules` against `codebase/package.json` so the
 * `missing-dependency-fix` injection activates whenever declared deps are
 * not yet resolvable. The same `areDepsInstalled` SSOT used by verification
 * plan entry backs this check; we do not introduce a parallel observation
 * path.
 *
 * Active task types: every code-writing type that can edit `package.json`
 * or rely on it. That set deliberately includes `verification` and `error`
 * now — the prior exclusion ("plan already carries `Session.dependencyStatus()`")
 * was wrong in practice: the plan-phase status lands in the plan template only,
 * but the actual `edit_file(package.json)` happens in execute. Without the
 * execute-side injection, the LLM got no "install required" directive right
 * next to the file-edit tool, leading to plans like "add `@types/jest` and
 * install" being honored as edit-only (observed in `lean-falling-dwarf`).
 *
 * Excluded task types:
 *   - `doc`, `explain` — do not modify code / cannot legitimately install.
 *
 * Returns `false` when `areDepsInstalled` reports `null` (non-JS project);
 * in that case the observation has nothing to say and the injection stays
 * dormant.
 */
export async function observeMissingDepsForTask(state: ArchitectGraphState): Promise<boolean> {
  const type = state.currentTask?.type;
  if (!type) return false;
  if (type === 'doc' || type === 'explain') return false;
  const featureRoot = state.deps?.fileSystem?.getRootPath?.();
  if (!featureRoot) return false;
  try {
    const { areDepsInstalled } = await import(
      '../../../../../common/tool/handlers/invalidationScope'
    );
    const installed = await areDepsInstalled(featureRoot);
    return installed === false;
  } catch {
    return false;
  }
}

/**
 * Build retry context from enforcement history so the LLM knows what was
 * already tried and failed. Returns null when not in a retry cycle.
 */
function buildRetryContext(state: ArchitectGraphState) {
  if (!state.retries || state.retries === 0 || !state.enforcementHistory?.length) {
    return null;
  }

  const history = state.enforcementHistory;
  const previousAttempts = history.map(h => ({
    attemptNumber: h.attemptNumber,
    approach: h.violations.map(v => v.suggestedFix || v.message).join('; ').substring(0, 200),
    error: h.violations.map(v => v.message).join('; ').substring(0, 200),
    wasCloseToSuccess: false,
  }));

  const currentViolations = state.violations || [];
  return {
    attemptNumber: state.retries + 1,
    originalDirective: state.context?.task?.substring(0, 300) || '',
    originalPlan: state.planText?.substring(0, 500) || '',
    keyDecisions: [],
    currentError: formatViolations(currentViolations).substring(0, 500),
    previousAttempts,
  };
}

/**
 * Build a one-shot user-content paragraph that tells the LLM how to resume
 * after a `max_tokens` truncation that cut off a `<file>` / `<append>`
 * block mid-stream. The partial body has already been written to disk by
 * FileRenderer's incremental emit; this block just names the path + tail
 * so the LLM can continue with `<append path="same">` instead of
 * re-emitting content the disk already has.
 *
 * Pure function — no state read/mutate. Caller (buildMessages) reads
 * `state._maxTokensTruncation`, passes it in, and clears the slot.
 */
export function buildMaxTokensResumeHint(
  info: { kind: 'file' | 'append'; path: string; tailContent: string },
): string {
  const previewSafe = info.tailContent.replace(/`/g, '\\`');
  return (
    `──────────────────────────────────────────────────────────────\n` +
    `🪓  PREVIOUS RESPONSE TRUNCATED MID-FILE — RESUME REQUIRED\n` +
    `──────────────────────────────────────────────────────────────\n\n` +
    `The previous response hit the LLM output ceiling while emitting a\n` +
    `\`<${info.kind} path="${info.path}">\` block. The content streamed up to the\n` +
    `cut point was already written to disk; the closing tag and everything\n` +
    `after it was lost.\n\n` +
    `Last \`${info.tailContent.length}\` characters written to disk (verbatim — match\n` +
    `exactly to find the resume point):\n\n` +
    `\`\`\`\n${previewSafe}\n\`\`\`\n\n` +
    `Resume by emitting \`<append path="${info.path}">\` with the content that\n` +
    `should come immediately after the tail above. Do NOT re-emit any content\n` +
    `that is already on disk. Keep this round's output well under the ceiling —\n` +
    `emit only the next chunk and end with \`<done>false</done>\` if more chunks\n` +
    `remain.\n\n` +
    `──────────────────────────────────────────────────────────────`
  );
}

/**
 * Build messages for LLM using PromptEngine with Prompt Caching
 *
 * ✅ Caching Strategy:
 * 1. System prompt + rules + profiles (cached - rarely changes)
 * 2. Selected artifact pool + foundation/schema anchors (cached per task)
 * 3. Runtime context — plan JSON, Existing Codebase Files manifest,
 *    Modify Targets current content, violations, current task (not cached;
 *    changes every turn)
 *
 * File awareness (after commit cbb4d924 removed `projectCodeContext`):
 * - Path manifest: `_existingCodebaseFiles` (seeded in execute/index.ts
 *   from the same disk listing that seeds `FileRegistry.existingFiles`)
 *   is rendered as the `Existing Codebase Files` section so the LLM can
 *   distinguish new creation from modification without a `list_files`
 *   round-trip.
 * - Modify content: `implementation.modify[]` targets in `state.planText`
 *   are read from disk and rendered as `Modify Targets — Current Content`
 *   so `edit_file` calls can be constructed without a prior `read_file`.
 */

/**
 * Framework-aware static-asset destination guidance.
 *
 * The design phase (`ui-assets-guide-*.md`) no longer commits to a
 * physical destination — that decision is gated on the `framework` axis
 * which only the code phase observes. This helper centralizes the rule
 * so prompt text stays consistent with whatever the actual generated
 * project will static-serve.
 *
 * Defaults assume SVGR is NOT pre-configured (the common case for
 * `setup-nextjs` task output). When a project explicitly wires
 * `@svgr/webpack`, the LLM is free to import SVGs from `src/assets/` —
 * the `note` field surfaces that option without making it the default.
 */
function describeAssetDestinations(framework: string | undefined): {
  svg: string;
  raster: string;
  svgInstruction: string;
  rasterInstruction: string;
  note: string | null;
} {
  const fw = (framework ?? '').toLowerCase();
  if (fw === 'nextjs' || fw === 'next' || fw === 'next.js') {
    return {
      svg: `codebase/public/assets/<category>/ (URL-referenced, e.g. <img src="/assets/.../foo.svg" />)`,
      raster: `codebase/public/assets/<category>/ (URL-referenced via <img> or next/image)`,
      svgInstruction: `copy to codebase/public/assets/ and reference by URL string`,
      rasterInstruction: `copy to codebase/public/assets/ and reference by URL string`,
      note: `Next.js serves only /public/* statically — placing SVG under src/assets/ will 404 unless @svgr/webpack is configured AND the SVG is imported (not URL-referenced). If themeAdaptation === "currentColor", consider rendering inline (React component) instead of via <img>.`,
    };
  }
  if (fw === 'vite' || fw === 'cra' || fw === 'create-react-app') {
    return {
      svg: `codebase/src/assets/<category>/ (SVGR import — bundler processes source tree)`,
      raster: `codebase/public/ (URL reference via framework image component)`,
      svgInstruction: `copy to codebase/src/assets/ and import as React component (SVGR)`,
      rasterInstruction: `copy to codebase/public/ and use framework image component`,
      note: null,
    };
  }
  return {
    svg: `codebase/src/assets/ or codebase/public/ — pick per the framework's static-serving convention`,
    raster: `codebase/public/ (URL reference) — or the framework's equivalent static folder`,
    svgInstruction: `place under the framework's static-asset root (URL-referenced) or under src/assets/ if the bundler supports source-tree imports`,
    rasterInstruction: `place under the framework's static-asset root and reference by URL`,
    note: `Framework "${framework ?? 'unknown'}" not explicitly recognized — choose paths per its static-serving convention; do NOT assume src/assets/ is web-accessible.`,
  };
}

export async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}>> {
  
  if (state.planText) {
    console.log(`🔍 [Execute] planText: ${state.planText.length} chars`);
  }

  if (!state.currentTask) {
    throw new Error('[Execute] currentTask is required but not available in state');
  }

  // Phase-mode dispatch SSOT — `activeExecuteHook` returns the
  // verify-mode shared hook when the task has entered verify-mode and
  // the bundle's apply-phase static hook otherwise. `undefined` keeps
  // the generic fallback path (feature / explain / ui / design-system
  // apply phase). Phase code never inspects `_verifyEntered`.
  const execHook = activeExecuteHook(state);

  if (!state.planText && !execHook && !schedClassify(state.currentTask, 'isFinal')) {
    console.warn(`⚠️  [Execute] planText is empty (task: ${state.currentTask.type}, priority: ${state.currentTask.priority})`);
  }
  
  // Execute reads files on-demand via read_file tool. No RAG dump block —
  // plan already planned WHICH files to modify; execute fetches only those
  // through its own tool calls. See docs/architecture/14-code-job.md.
  const taskTechTiers = state.currentTask.techTiers ?? (getTechTier(state) ? [getTechTier(state)!] : []);
  const contextWithTechTier = {
    ...state.context,
    techTier: effectiveTechTier(taskTechTiers),
    techTiers: taskTechTiers,
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Artifact selection via ArtifactPipeline
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const pool = poolView.all;

  // Single per-task injection SSOT — `task.include` only. Both explicit and
  // infer pipelines flow through the SAME narrowing path; the legacy explicit
  // full-RAC bypass (which injected `refs ∪ context` wholesale and ignored
  // `task.include`) is removed so per-task narrowing is structurally possible.
  // Pool doc not pre-injected here is reachable on-demand via RAC-scoped reads
  // (the code `tool` node gate). `verification` → selectArtifacts returns [].
  let resolvedActionWithDocs = state.resolvedAction;
  const task = state.currentTask;
  const selected = selectArtifacts(pool, { taskType: task.type, include: task.include });
  const inferred = compactArtifacts(selected, { threshold: 30_000 });

  if (inferred.length > 0) {
    resolvedActionWithDocs = {
      ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
      artifacts: inferred,
      documents: inferred,
    };
    const totalChars = inferred.reduce((s, a) => s + (a.content?.length || 0), 0);
    console.log(`📄 [Execute] ${pool.length} pool → ${inferred.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(task.include ?? [])})`);
  }

  const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');
  const hasUiArtifacts = getRACDocuments(resolvedActionWithDocs).some(
    a => a.path.startsWith(AP.UI),
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build prompt via PromptBuilder (4-tier injection resolution)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const taskType = state.currentTask.type;
  const skipExamples = execHook?.skipExamples ?? false;
  const skipCrossTaskContext = execHook?.skipCrossTaskContext ?? false;

  const intent = state.resolvedAction?.intent;
  const effectiveTier = effectiveTechTier(taskTechTiers);
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);

  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Execute] PromptBuilder is required but not available in state.deps');

  const { base: templateBase, rules: templateRules } =
    execHook?.templatePaths ?? DEFAULT_EXECUTE_TEMPLATES;

  const formattedLessons = formatLessonsForPrompt(state.lessons);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Build runtime context → vars.runtimeContext (rendered into Block 3 via base template)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const runtimeContextParts: string[] = [];

  if (state.violations && state.violations.length > 0) {
    const violationsText = formatViolations(state.violations);
    runtimeContextParts.push(
      `──────────────────────────────────────────────────────────────\n` +
      `⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED\n` +
      `──────────────────────────────────────────────────────────────\n\n` +
      `${violationsText}\n\n` +
      `Focus on fixing the root cause, not workarounds.\n\n` +
      `──────────────────────────────────────────────────────────────`,
    );
  }

  // safe-braking-eagle option C: one-shot truncation-recovery hint.
  // Set by execute when the previous round's stream ended with
  // `stopReason === 'max_tokens'` while a `<file>` / `<append>` block was
  // still open. The hint names the path + last ~240 chars already written
  // to disk so the LLM resumes with `<append>` instead of re-emitting.
  // Cleared after consumption (per-attempt only).
  if (state._maxTokensTruncation) {
    runtimeContextParts.push(buildMaxTokensResumeHint(state._maxTokensTruncation));
    state._maxTokensTruncation = undefined;
  }

  // Split into task-invariant (Block 2, cached) vs turn-variable (Block 3,
  // uncached) parts. See CacheBlockMapper docblock for the invariance axis.
  // Invariant part is wired into `buildCacheableBlocks(..., { taskInvariantParts })`
  // below; variable part stays in the `runtimeContext` template var (Block 3).
  const [taskInvariantRuntime, turnVariableRuntime] = await Promise.all([
    buildTaskInvariantContext(state),
    buildTurnVariableContext(state),
  ]);
  if (turnVariableRuntime) runtimeContextParts.push(turnVariableRuntime);

  const _basisDiag = state.resolvedAction?.basis;
  if (!_basisDiag) {
    console.warn(`⚠️  [Execute] state.resolvedAction.basis is ${_basisDiag === undefined ? 'undefined' : 'falsy'} (resolvedAction exists: ${!!state.resolvedAction}, intent: ${state.resolvedAction?.intent})`);
  } else {
    console.log(`📐 [Execute] basis present: stack=${_basisDiag.techTier?.stack || 'none'}, visualTier=${_basisDiag.visualTier ? Object.keys(_basisDiag.visualTier).join(',') : 'none'}`);
  }

  const config: PromptBuildConfig = {
    templates: {
      base: templateBase,
      rules: templateRules,
      system: TEMPLATE_PATHS.codeExecuteDefault.system!,
    },
    intent,
    artifactPolicies: intent
      ? deriveArtifactPolicies(intent, getRACDocuments(resolvedActionWithDocs))
      : [],
    techContext: {
      techTier: effectiveTier,
      techTiers: taskTechTiers,
      taskType,
      mode: state.resolvedAction?.mode,
      resolvedAction: resolvedActionWithDocs,
    },
    basis: state.resolvedAction?.basis,
    pipeline: {
      sanitizeInput: true,
      includeBasis: true,
      includeExamples: !skipExamples,
      applyPolicyGuardrails: true,
      formatForLLM: true,
    },
    artifacts: getRACDocuments(resolvedActionWithDocs),
    vars: {
      currentTask: state.currentTask ? {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      } : null,
      // SBS gate variable consumed by entry-point-ownership-rule and
      // execution-context-discipline partials. Mirrors plan/llm/prompt.ts:183 —
      // only feature tasks carry a band; other types resolve to undefined and
      // fall through to the non-integration branch. Exposing this here is
      // required so the band-conditional ownership partial renders the same
      // SSOT at execute time as at plan time.
      taskBand: state.currentTask?.type === 'feature'
        ? (state.currentTask as FeatureTask).band
        : undefined,
      // R1 template dispatch — the final-verification guard in templates
      // (previously `{{#unless (eq currentTask.priority 1000)}}`) now reads
      // `currentTaskIsFinal` so the verification bundle's classify is the
      // SSOT for "this task is the queue-terminal final verification".
      currentTaskIsFinal: schedClassify(state.currentTask, 'isFinal'),
      directive: execHook?.sanitizeDirective
        ? execHook.sanitizeDirective(state.directive || '')
        : (state.directive || ''),
      referenceRequests: state.referenceRequests || [],
      // Gate flag — execute branches on whether UI artifacts are
      // present in the post-RAC selected pool. Role is inherited from the
      // pool's RAC annotation (3-axis Authority); the template only needs
      // presence. See `AGENTS.md` "Post-RAC Template Condition SSOT".
      hasUi: new ArtifactPoolView(getRACDocuments(resolvedActionWithDocs)).hasUi(),
      uiSource: new ArtifactPoolView(getRACDocuments(resolvedActionWithDocs)).uiSource(),
      isSpecDriven: new ArtifactPoolView(state.artifacts || []).activeSpecRefFilename() !== null,
      // Stack flags — mirror plan/planGeneration.ts (single SSOT via
      // AutoInjectionResolver.computeStackFlags). Required by Handlebars
      // gates including the Service Virtualization imagery partial.
      hasFrontend,
      hasBackend,
      // Service Virtualization gates (SBS) — four orthogonal partials
      // (contract / data / imagery / session). The `hasBusinessConnection`
      // flag is derived once at resolve time and parked on
      // `state.virtualizationSnapshot` so every phase shares one snapshot.
      // See `core/prompt/builder/serviceVirtualization/`.
      serviceVirtualizationContractActive: isServiceVirtualizationContractActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
      }),
      serviceVirtualizationDataActive: isServiceVirtualizationDataActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
        taskType,
      }),
      serviceVirtualizationImageryActive: isServiceVirtualizationImageryActive({
        hasFrontend,
        domain: state.resolvedAction?.domain,
        taskType,
      }),
      // Session partial is split into three blocks, each gated by a different
      // signal: band → world-seed (platform shared service / setup),
      // renderable → body-lifecycle (data-bearing visual surface),
      // taskType → auth-flow (narrowed in-body by an LLM-self condition).
      serviceVirtualizationSessionActive: isServiceVirtualizationSessionActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
        taskType,
        band: (state.currentTask as { band?: string }).band,
        renderable: (state.currentTask as { renderable?: boolean }).renderable,
      }),
      svWorldSeedActive: isSvWorldSeedActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
        taskType,
        band: (state.currentTask as { band?: string }).band,
      }),
      svBodyLifecycleActive: isSvBodyLifecycleActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
        renderable: (state.currentTask as { renderable?: boolean }).renderable,
      }),
      svAuthFlowActive: isSvAuthFlowActive({
        hasBusinessConnection: state.virtualizationSnapshot?.hasBusinessConnection === true,
        taskType,
      }),
      // figmaAvailable is strictly derived from uiSource === 'figma'.
      // The previous AND-with-!hasUi() gate is obsolete; hard-exclusive UiSource
      // means figma and ant/handoff never coexist in the same pool.
      figmaAvailable: state.resolvedAction?.mcpSources?.figma != null,
      figmaFileKey: state.resolvedAction?.mcpSources?.figma?.fileKey ?? state.figmaFileKey ?? undefined,
      figmaStartNodeId: state.resolvedAction?.mcpSources?.figma?.nodeId ?? state.figmaStartNodeId ?? undefined,
      runtimeContext: runtimeContextParts.join('\n\n'),

      lessons: formattedLessons,
      content: formattedLessons, // for memory.md
      sessionContext: state.sessionContext ? formatSessionContextForPrompt(state.sessionContext) : '',
      retryContext: buildRetryContext(state),
      resolvedAction: resolvedActionWithDocs || null,
      userLanguage: state.context?.userLanguage || 'en',
      filteredCatalog: undefined,
      hasRuntimeError: containsRuntimeErrorPattern(state.directive),
      // `missing-dependency-fix` activation: a task that declares or relies
      // on deps owns the install within the same cycle. Flipped true when
      // `codebase/node_modules` does not resolve every declared dep in
      // `codebase/package.json`. Verification / error keep their SSOT via
      // `Session.dependencyStatus()`; doc / explain opt out (see
      // `observeMissingDepsForTask`).
      hasMissingDependency: await observeMissingDepsForTask(state),
      antrulesContent: loadAntrules(state.context?.featurePath),
      // `prePlanText` flags batch-split sub-tasks so per-type execute
      // overlays can branch on "spawned from a parent's `batches[]`".
      // Consumed by the `test-code-task` execute overlay to enforce the
      // slice-scope constraints (no install, no manifest edits, no shared
      // config). Non-sub-tasks leave this falsy and templates fall back
      // to their regular scope block.
      prePlanText: (state.currentTask as CodeTask)?.prePlanText ?? '',
      // Cross-task output manifest — files prior tasks in this job already
      // authored (paths only). Same SSOT as the plan side
      // (`nodes/plan/llm/prompt.ts`); closes the forward-visibility gap so a
      // task imports/reuses an existing shared store / route / component
      // instead of recreating it. Bodies read on-demand via codebase path.
      priorCompletedFiles: renderPriorCompletedFiles(state, state.currentTask as CodeTask),
      // Task-specific vars (e.g. error's remediationMode{Upstream,Refactor}).
      // Placed last so the hook's keys override generic defaults if ever
      // required; today error is the sole publisher and it only adds keys.
      ...(execHook?.extraTemplateVars?.({
        state,
        task: state.currentTask,
      }) ?? {}),
    },
  };

  const promptResult = await promptBuilder.build(config);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Additional context parts for Block 2
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const schemaAnchor = skipCrossTaskContext ? null : await buildSchemaAnchor(state);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI Images (NOT CACHED - multimodal blocks)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const uiImageBlocks: CacheableContent[] = [];
  try {
    const llmProvider = state.deps?.llm?.provider;
    const canSendImages = llmProvider === 'anthropic';

    if (hasUiArtifacts && canSendImages && state.deps?.fileSystem) {
      const handoffImages = await ArtifactService.loadHandoffImages(state.context, state.deps.fileSystem);

      if (handoffImages) {
        const fs = await import('fs');
        const path = await import('path');

        const fileSystem = state.deps.fileSystem;

        const maxImages = parseInt(process.env.ANT_UI_IMAGE_MAX || '4', 10);
        const maxBytesPerImage = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${2 * 1024 * 1024}`, 10);
        const maxTotalBytes = parseInt(process.env.ANT_UI_IMAGE_TOTAL_MAX_BYTES || `${8 * 1024 * 1024}`, 10);

        const candidates: string[] = handoffImages
          .filter(Boolean)
          .map(p => (typeof p === 'string' ? p.replace(/\\/g, '/') : p))
          .filter(p => !p.includes('/.gitkeep') && !p.endsWith('/.gitkeep'));

        let totalBytes = 0;

        if (candidates.length > 0) {
          uiImageBlocks.push({
            type: 'text',
            text:
              `# UI Handoff Images\n` +
              `The blocks that follow pair each handoff binary preview with its source path (caption immediately precedes its image). Use the previews to match layout/spacing/visual states. Other binary entries in the stub manifest are path-only references with no attached preview.\n` +
              `IMPORTANT (runtime packaging, NOT authority): These image files are inputs to this prompt only — they are NOT automatically copied into the app runtime (e.g., not placed under \`public/\`). If the implementation needs runtime images/icons, either (a) generate placeholders in the codebase or (b) follow explicit instructions in \`visual/ui/ant/ui-assets.json\` (including destination paths).\n`,
          });
        }

        for (const rel of candidates) {
          if (uiImageBlocks.filter(b => (b as any).type === 'image').length >= maxImages) break;

          // `rel` is an LLM/artifact-derived workspace-relative path, so we
          // must traversal-protect. Use the port's resolver instead of
          // re-implementing `path.resolve(...)` + `startsWith(...)` here.
          let abs: string;
          try {
            abs = fileSystem.resolveAbsolute(rel);
          } catch {
            continue; // outside workspace — skip silently like before
          }
          if (!fs.existsSync(abs)) continue;

          const stat = fs.statSync(abs);
          if (stat.size > maxBytesPerImage) {
            console.log(`⚠️  [UI Images] Skip (too large): ${rel} (${stat.size} bytes)`);
            continue;
          }
          if (totalBytes + stat.size > maxTotalBytes) {
            console.log(`⚠️  [UI Images] Skip (total budget exceeded): ${rel}`);
            continue;
          }

          // Anthropic API rejects when the declared `media_type` does not
          // match the actual base64 content (e.g. a `.png`-named file that
          // is actually JPEG — sage-orbiting-grain RCA). Sniff magic bytes
          // off the buffer; only fall back to extension for SVG (text XML,
          // no binary signature).
          const buf = fs.readFileSync(abs);
          let mediaType: AnthropicImageMime | 'image/svg+xml' | null =
            detectImageMimeFromBuffer(buf);
          if (!mediaType) {
            const ext = path.extname(abs).toLowerCase();
            if (ext === '.svg') mediaType = 'image/svg+xml';
          }
          if (!mediaType) continue;

          const data = buf.toString('base64');
          totalBytes += stat.size;

          uiImageBlocks.push({
            type: 'text',
            text: `Image preview — ${rel}:`,
          });
          uiImageBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as any,
              data,
            },
          });
        }

        if (uiImageBlocks.some(b => (b as any).type === 'image')) {
          console.log(`🖼️  [UI Images] Injected ${uiImageBlocks.filter(b => (b as any).type === 'image').length} image(s) (total=${totalBytes} bytes)`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️  [UI Images] Failed to build image blocks (non-fatal):`, e);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Assemble blocks via CacheBlockMapper
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const preflightManager = new TokenBudgetManager();
  const blocks = buildCacheableBlocks(promptResult, {
    contextParts: [schemaAnchor].filter(Boolean) as string[],
    taskInvariantParts: taskInvariantRuntime ? [taskInvariantRuntime] : undefined,
    mediaBlocks: uiImageBlocks.length > 0 ? uiImageBlocks : undefined,
    tokenPreflight: {
      maxBlock2Tokens: preflightManager.getAreaBudgets().projectContext,
      estimateTokens: (t) => preflightManager.estimateTokens(t),
    },
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Cache stability check
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const currentTaskId = state.currentTask?.id || 'unknown';
    if (_lastCacheBlockHashes.taskId !== currentTaskId) {
      _lastCacheBlockHashes = { taskId: currentTaskId };
    }

    const block1Text = blocks[0]?.type === 'text' ? blocks[0].text : '';
    const block2Text = blocks[1]?.type === 'text' ? blocks[1].text : '';
    const b1Hash = createHash('md5').update(block1Text).digest('hex').slice(0, 12);
    const b2Hash = createHash('md5').update(block2Text).digest('hex').slice(0, 12);
    const b1Len = block1Text.length;
    const b2Len = block2Text.length;
    const histLen = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length;

    // Synchronously snapshot prev hashes before the module-level record gets
    // updated below — otherwise async logger callbacks (microtask-scheduled
    // import().then) would read the already-overwritten new hash and record
    // prevHash === currHash.
    const prevB1 = _lastCacheBlockHashes.block1;
    const prevB2 = _lastCacheBlockHashes.block2;

    // Static import + synchronous writeQueue update — see executionLogger
    // contract (vast-curling-perch C-3 RCA). This eliminates the previous
    // microtask-scheduled `import().then` race that the comment above
    // referenced (the prev-hash snapshot is still kept for symmetry, but
    // the dynamic-import scheduling concern is now moot).
    if (prevB1 && prevB1 !== b1Hash) {
      console.warn(`⚠️  [CacheStability] Block1 CHANGED between calls! prev=${prevB1} curr=${b1Hash} len=${b1Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        void getExecutionLogger({ featurePath: state.context.featurePath, jobId: state._httpJobId, jobType: 'code' })
          .logCacheInstability(currentTaskId, { block: 'block1', prevHash: prevB1, currHash: b1Hash, contentLength: b1Len, historyLength: histLen })
          .catch(() => { /* non-blocking */ });
      }
    }
    if (prevB2 && prevB2 !== b2Hash) {
      console.warn(`⚠️  [CacheStability] Block2 CHANGED between calls! prev=${prevB2} curr=${b2Hash} len=${b2Len} (task=${currentTaskId}, hist=${histLen})`);
      if (state.context?.featurePath && state._httpJobId) {
        void getExecutionLogger({ featurePath: state.context.featurePath, jobId: state._httpJobId, jobType: 'code' })
          .logCacheInstability(currentTaskId, { block: 'block2', prevHash: prevB2, currHash: b2Hash, contentLength: b2Len, historyLength: histLen })
          .catch(() => { /* non-blocking */ });
      }
    }

    if (histLen === 0) {
      console.log(`🔑 [CacheStability] New task → Block1=${b1Hash}(${b1Len}) Block2=${b2Hash}(${b2Len})`);
    }
    _lastCacheBlockHashes = { block1: b1Hash, block2: b2Hash, taskId: currentTaskId };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Compose messages via MessageComposer
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // History budget keyed to the REAL model window (dim-beating-brass RCA).
  // The 50K/75K defaults evicted already-read file content mid-task and
  // forced the model to re-read the same files until it burned the recursion
  // budget. Size the conversation-history area to a large share of the active
  // window and trip compaction only near that share, so reads stay resident.
  // `getModelContextWindow` returns the real ceiling once the model is on a
  // larger window (e.g. Opus 1M); today it tracks whatever the architect
  // model actually exposes (falling back to 200K).
  const execModelId = state.deps?.llm ? extractLLMInfo(state.deps.llm).model : undefined;
  // getModelContextWindow throws on unknown/undefined modelId — never let a
  // model-table gap break message composition; fall back to the legacy 200K.
  let execWindowTokens = 200_000;
  try {
    if (execModelId) execWindowTokens = getModelContextWindow(execModelId);
  } catch {
    execWindowTokens = 200_000;
  }
  // Reserve room for system/project/task blocks + output/overhead; give the
  // rest to history. Floored at the legacy 75K so we never regress below it.
  const HISTORY_RESERVED_TOKENS = 105_000; // 30K+30K+25K area blocks + ~20K output/overhead margin
  const execHistoryBudget = Math.max(
    75_000,
    Math.min(Math.floor(execWindowTokens * 0.7), execWindowTokens - HISTORY_RESERVED_TOKENS),
  );
  const execTokenManager = new TokenBudgetManager({
    // Pass the already-resolved maxTokens (short-circuits the constructor's
    // own getModelContextWindow call, which throws on unknown models);
    // modelId is kept for config provenance only.
    maxTokens: execWindowTokens,
    ...(execModelId ? { modelId: execModelId } : {}),
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: execHistoryBudget,
    },
  });
  const { messages } = composeMessages({
    initialBlocks: blocks,
    priorTurns: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE) as any,
    cleanAssistantContent: cleanFileContentFromResponse,
    tokenManager: execTokenManager,
    // Standard-stage compaction trips only near the history budget (not 50K),
    // and keeps a deeper hot tail so recent reads survive intact.
    compactParams: {
      autoCompactThreshold: Math.floor(execHistoryBudget * 0.9),
      autoCompactHotTail: 8,
    },
    budgetRecovery: {
      aggressiveParams: { autoCompactThreshold: 20000, autoCompactHotTail: 1 },
      stubBlockIndex: 1,
      stubText: '[Project context omitted to fit token budget — use read_file and search_code tools to access codebase]',
    },
  });

  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      const totalPromptLength = messages.reduce((sum: number, m: any) => {
        if (Array.isArray(m.content)) {
          return sum + m.content.reduce((s: number, c: any) => s + (c.type === 'text' ? c.text.length : 0), 0);
        }
        return sum + (typeof m.content === 'string' ? m.content.length : 0);
      }, 0);
      
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'execute-fullMessage',
        totalPromptLength,
        {
          taskId: state.currentTask?.id,
          taskName: state.currentTask?.name,
          callIndex: state._executeCallIndex,
          templatePath: templateBase,
          usedTemplates: [
            templateBase,
            templateRules,
            ...promptResult.injections,
          ].filter(Boolean),
          resolvedPartials: collectResolvedPartials([
            templateBase,
            templateRules,
          ].filter(Boolean)),
          injectedVariables: {
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            artifactPool: pool.length,
            artifactsSelected: getRACDocuments(resolvedActionWithDocs).length,
            include: state.currentTask?.include || undefined,
            stack: state.currentTask?.stack || undefined,
            planText: state.planText ? `[${state.planText.length} chars]` : undefined,
            detectedMode: state.resolvedAction?.mode,
            taskType: state.currentTask?.type,
            uiImageBlocksCount: uiImageBlocks.filter(b => (b as any).type === 'image').length,
            hasViolations: !!(state.violations?.length),
            violationsCount: state.violations?.length || 0,
            messageCount: messages.length,
            nodeHistoryLength: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
            profileLanguage: getTechTier(state)?.language || null,
            profileFramework: getTechTier(state)?.framework || null,
            profilesLoaded: !!promptResult.sections.profiles,
            failedTemplates: promptResult.sections.failedTemplates.length > 0 ? promptResult.sections.failedTemplates : undefined,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Execute] Failed to log prompt:`, logError);
    }
  }

  return messages;
}

const MANIFEST_MAX_ENTRIES = 100;
const MODIFY_CONTENT_PER_FILE_CAP = 30_000;
const MODIFY_CONTENT_TOTAL_CAP = 80_000;

/**
 * Extract `implementation.modify[].target` paths from a plan-JSON string.
 * Tolerant of code-fence wrapping and non-JSON content (returns []).
 */
function extractPlanModifyPaths(planText: string | undefined): string[] {
  if (!planText) return [];
  const stripped = planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  try {
    const parsed = JSON.parse(stripped);
    const modify = parsed?.implementation?.modify;
    if (!Array.isArray(modify)) return [];
    const paths: string[] = [];
    for (const entry of modify) {
      const target = typeof entry === 'string' ? entry : entry?.target;
      if (typeof target === 'string' && target.length > 0) paths.push(target);
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Render the `Modify Targets — Current Content` section — reads each
 * plan.modify target from disk and lays out its current content so the
 * LLM can build exact `edit_file` calls without a prior `read_file`
 * round-trip. Caps per-file and total chars to protect the token budget.
 */
export async function buildModifyTargetsSection(state: ArchitectGraphState): Promise<string | null> {
  const paths = extractPlanModifyPaths(state.planText);
  if (paths.length === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  // Align with FileRenderer / execute/index.ts — plan targets may be written
  // as bare `src/...` paths while the workspace-rooted fileSystem needs the
  // `codebase/` prefix. Without this normalization every modify target reads
  // as "file not found", which used to emit "treat as new creation" and
  // pushed the LLM into `<file>` (overwrite) instead of `edit_file`.
  const codebaseRel = await resolveCodebaseRel(state);

  const blocks: string[] = [];
  let totalChars = 0;

  for (const p of paths) {
    if (totalChars >= MODIFY_CONTENT_TOTAL_CAP) {
      blocks.push(`\n[remaining modify targets omitted — use \`read_file\` to fetch: ${paths.slice(blocks.length).join(', ')}]`);
      break;
    }
    const { normalized } = normalizeToCodebasePath(p, codebaseRel);
    let content: string | undefined;
    try {
      content = await fileSystem.readFile(normalized) ?? undefined;
    } catch {
      content = undefined;
    }
    if (content === undefined) {
      blocks.push(
        `### ${p}\n\n` +
        `[file not found on disk at \`${normalized}\` — call \`read_file\` to verify the current location before deciding. ` +
        `If the file truly does not exist, create it with \`<file>\`. ` +
        `If it exists at a different path, call \`edit_file\` on that path — do NOT use \`<file>\` on existing files.]`
      );
      continue;
    }
    let body = content;
    if (body.length > MODIFY_CONTENT_PER_FILE_CAP) {
      body = body.slice(0, MODIFY_CONTENT_PER_FILE_CAP) + `\n... [truncated at ${MODIFY_CONTENT_PER_FILE_CAP} chars, use \`read_file\` for full content]`;
    }
    const budgetLeft = MODIFY_CONTENT_TOTAL_CAP - totalChars;
    if (body.length > budgetLeft) {
      body = body.slice(0, Math.max(0, budgetLeft)) + `\n... [truncated — total budget reached, use \`read_file\` for full content]`;
    }
    totalChars += body.length;
    blocks.push(`### ${p}\n\n\`\`\`\n${body}\n\`\`\``);
  }

  if (blocks.length === 0) return null;

  return [
    `════════════════════════════════════════════════════════════════════════════════`,
    `📝 Modify Targets — Current Content`,
    `════════════════════════════════════════════════════════════════════════════════`,
    ``,
    `The following files are listed in plan.modify. Their current on-disk content is below.`,
    `Use \`edit_file\` for partial changes. Do NOT re-emit these via \`<file>\` tag — that would overwrite.`,
    ``,
    blocks.join('\n\n'),
    ``,
    `════════════════════════════════════════════════════════════════════════════════`,
    ``,
  ].join('\n');
}

/**
 * Task-invariant runtime context — Current Task header + plan JSON +
 * runtime-assets index + existing-codebase-files manifest.
 *
 * Every section rendered here is fixed for the lifetime of a single task
 * (plan node writes `state.planText` once; `runtimeAssetsIndex` is
 * sealed in `resolve/index.ts`; `_existingCodebaseFiles` is sealed in
 * `execute/index.ts` at task entry). The caller (`buildMessages`)
 * forwards this string into `buildCacheableBlocks` as a
 * `taskInvariantParts` entry so it participates in Block 2 (cached).
 *
 * Keep this function free of anything that mutates per execute recursion
 * — those belong in `buildTurnVariableContext` below. See
 * `CacheBlockMapper` docblock for the full invariance invariant.
 */
export async function buildTaskInvariantContext(state: ArchitectGraphState): Promise<string> {
  const lines: string[] = [];

  // Phase-mode-aware execHook lookup — same SSOT dispatch as
  // `buildMessages` (verify-mode → shared hook, apply-mode → bundle's
  // apply-phase hook, undefined → generic fallback).
  const execHook = activeExecuteHook(state);

  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);

    // Remediation-style framing (verification / error) vs generic
    // implementation framing is driven by `execute.runtimePlanFraming`
    // so the phase layer never branches on `task.type`.
    const framing = execHook?.runtimePlanFraming;
    const isRemediationTask = !!framing;

    // Safety guard: detect batched planText that leaked through processDiagnosticBatchSplit failure.
    // If the plan contains a `batches` array, it was meant to be split into sub-tasks, not executed directly.
    // Log INVARIANT VIOLATION but do NOT modify the planText — silent fallbacks mask bugs.
    if (state.planText && isRemediationTask) {
      try {
        const stripped = state.planText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
        const parsed = JSON.parse(stripped);
        if (parsed.batches && Array.isArray(parsed.batches) && parsed.batches.length > 1) {
          console.error(`❌ [Execute] INVARIANT VIOLATION: Batched planText leaked to execute (${parsed.batches.length} batches). processDiagnosticBatchSplit should have split this. planRouter should have routed to checkTaskStatus. This is a system bug.`);
        }
      } catch { /* not valid JSON — proceed normally */ }
    }

    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);

      const planLabel = framing?.label ?? DEFAULT_PLAN_FRAMING.label;
      const planDescription = framing?.description ?? DEFAULT_PLAN_FRAMING.description;

      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(planLabel);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
      lines.push(planDescription);
      lines.push(``);
      lines.push('```json');
      lines.push(state.planText);
      lines.push('```');
      lines.push(``);
      lines.push(`════════════════════════════════════════════════════════════════════════════════`);
      lines.push(``);
    } else {
      lines.push(state.currentTask.description);
      lines.push(``);
      const fallback = execHook?.emptyPlanFallback?.(state.currentTask);
      if (fallback) {
        lines.push(fallback);
        lines.push(``);
      }
    }
  }

  // ✅ Runtime assets reminder (text-only, small)
  if (state.runtimeAssetsIndex?.count && state.runtimeAssetsIndex.count > 0) {
    const idx = state.runtimeAssetsIndex;
    // Framework-aware destination guidance. Physical placement is a
    // `framework` gate concern (SBS) — the design phase no longer commits
    // `dest` paths (see ui-assets-guide-*.md), so the code phase derives
    // them here from the effective tech tier. Old guidance hardcoded
    // `src/assets/` for SVGs assuming SVGR + webpack, which silently
    // 404s under Next.js's `/public/*`-only static serving.
    const taskTechTiers = state.currentTask?.techTiers
      ?? (getTechTier(state) ? [getTechTier(state)!] : []);
    const framework = effectiveTechTier(taskTechTiers).framework;
    const dest = describeAssetDestinations(framework);

    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📦 Available Assets (assets/)`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`Check if this task needs any assets from the list below.`);
    lines.push(`If needed: SVG (.svg) → ${dest.svgInstruction}`);
    lines.push(`Raster (png, jpg, webp) → ${dest.rasterInstruction}`);
    lines.push(``);
    if (state.context?.featurePath) {
      lines.push(`Source: ${state.context.featurePath.replace(/\\/g, '/')}/assets/`);
    }
    lines.push(`SVG destination: ${dest.svg}`);
    lines.push(`Raster destination: ${dest.raster}`);
    if (dest.note) {
      lines.push(`Note: ${dest.note}`);
    }
    lines.push(``);
    lines.push(`Available files (${idx.count} total):`);
    idx.files.slice(0, 20).forEach((f) => lines.push(`  - ${f}`));
    if (idx.count > 20) lines.push(`  ... and ${idx.count - 20} more`);
    lines.push(``);
  }
  
  // Existing Codebase Files manifest — paths-only listing of files that
  // exist on disk at TASK START. Sealed by `execute/index.ts` L301 via
  // `state._existingCodebaseFiles = existingCodebaseDiskFiles` so this
  // slice is invariant across recursions. The per-recursion parallel
  // worker manifest lives in `buildTurnVariableContext` and takes
  // precedence when paths overlap (wording there makes the ordering
  // explicit — raw dedupe here would make the invariant Block 2 slice
  // depend on a Block 3 value).
  const existingFiles = state._existingCodebaseFiles ?? [];
  if (existingFiles.length > 0) {
    const shown = existingFiles.slice(0, MANIFEST_MAX_ENTRIES);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📋 Existing Codebase Files`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`The following files ALREADY EXIST on disk at task start.`);
    lines.push(`For changes to these files: use \`edit_file\` tool (search/replace).`);
    lines.push(`Do NOT use \`<file>\` tag on any of these paths — it overwrites all content.`);
    lines.push(``);
    for (const p of shown) lines.push(`  - ${p}`);
    if (existingFiles.length > MANIFEST_MAX_ENTRIES) {
      lines.push(``);
      lines.push(`... and ${existingFiles.length - MANIFEST_MAX_ENTRIES} more files`);
    }
    lines.push(``);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Turn-variable runtime context — parallel-worker file manifest + plan
 * modify-target current contents.
 *
 * Both sections can change **within** a single task's execute recursion:
 *
 *   - `_otherWorkerFiles` is re-collected at every `execute/index.ts`
 *     entry from `sharedBuffer.getWrittenByOtherTasks()` (L121~135);
 *     parallel workers that complete between two recursions appear here
 *     even though the task itself did nothing.
 *   - `buildModifyTargetsSection` reads the current on-disk content of
 *     each `plan.modify` target; when this task's previous recursion
 *     called `edit_file`, the rendered content differs on the next call.
 *
 * Because of those, this string is forwarded into Block 3 (uncached)
 * via the existing `runtimeContext` template variable — NOT into
 * `taskInvariantParts`.
 *
 * Violation text is pushed separately at the call site in
 * `buildMessages` (see `runtimeContextParts[0]`) — it is also Block 3
 * material but lives in the existing "previous attempt failed" framing
 * that predates this split.
 */
export async function buildTurnVariableContext(state: ArchitectGraphState): Promise<string> {
  const lines: string[] = [];

  // Session File Manifest: Show files created by OTHER parallel workers.
  // Re-collected at every execute entry, so cannot be cached.
  const otherWorkerFiles = state._otherWorkerFiles;
  if (otherWorkerFiles && otherWorkerFiles.length > 0) {
    const MAX_MANIFEST_ENTRIES = 40;
    const filesToShow = otherWorkerFiles.slice(0, MAX_MANIFEST_ENTRIES);

    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(`📋 Files Created by Parallel Tasks`);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
    lines.push(`The following files were created by other tasks running in parallel with yours.`);
    lines.push(`If a path here also appears under "Existing Codebase Files" above, THIS list is authoritative (the parallel writer owns the file).`);
    lines.push(`Do NOT create duplicates. If you need to import from or extend these files, use \`read_file\` to check their content first.`);
    lines.push(``);

    // Group by task name for readability
    const byTask = new Map<string, string[]>();
    for (const f of filesToShow) {
      const taskKey = f.taskName || 'unknown';
      if (!byTask.has(taskKey)) byTask.set(taskKey, []);
      byTask.get(taskKey)!.push(f.path);
    }

    for (const [taskName, paths] of byTask) {
      lines.push(`**${taskName}**:`);
      for (const p of paths) {
        lines.push(`  - ${p}`);
      }
    }

    if (otherWorkerFiles.length > MAX_MANIFEST_ENTRIES) {
      lines.push(``);
      lines.push(`... and ${otherWorkerFiles.length - MAX_MANIFEST_ENTRIES} more files`);
    }
    lines.push(``);
    lines.push(`════════════════════════════════════════════════════════════════════════════════`);
    lines.push(``);
  }

  // Modify Targets — current on-disk content for every plan.modify entry.
  // Changes after `edit_file` tool calls so it cannot be cached.
  const modifyTargetsSection = await buildModifyTargetsSection(state);
  if (modifyTargetsSection) {
    lines.push(modifyTargetsSection);
  }

  return lines.join('\n');
}


/**
 * Build Schema Anchor: concise table/type summary extracted from migration SQL files.
 * Prevents feature tasks from referencing non-existent columns or tables.
 * Active in parallel mode where SharedFileBuffer surfaces cross-worker migration writes.
 */
async function buildSchemaAnchor(state: ArchitectGraphState): Promise<string | null> {
  const otherWorkerFiles = state._otherWorkerFiles;
  if (!otherWorkerFiles || otherWorkerFiles.length === 0) return null;

  const migrationPaths = new Set<string>();
  for (const f of otherWorkerFiles) {
    if (isMigrationFile(f.path)) migrationPaths.add(f.path);
  }

  if (migrationPaths.size === 0) return null;

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) return null;

  const schemas: string[] = [];
  const sortedPaths = Array.from(migrationPaths).sort();
  for (const filePath of sortedPaths) {
    let content: string | undefined;
    try { content = await fileSystem.readFile(filePath) || undefined; } catch { /* skip */ }
    if (!content) continue;

    const tables = extractTableSchemas(content);
    schemas.push(...tables);
  }

  if (schemas.length === 0) return null;

  const sections = [
    '# Database Schema (from migrations, read-only reference)\n',
    'Use this schema when writing queries. Do NOT reference columns not listed here.\n',
    ...schemas,
  ];

  const result = sections.join('\n');
  console.log(`📋 [Execute] Schema anchor: ${migrationPaths.size} migration(s), ${schemas.length} table/type(s), ${result.length} chars`);
  return result;
}

function isMigrationFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.sql')) return false;
  return lower.includes('migration') || lower.includes('schema') || lower.includes('migrate');
}

function extractTableSchemas(sql: string): string[] {
  const results: string[] = [];

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns: string[] = [];

    for (const rawLine of body.split('\n')) {
      const trimmed = rawLine.trim().replace(/,\s*$/, '');
      if (!trimmed) continue;
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT\s)/i.test(trimmed)) continue;
      columns.push(`  ${trimmed}`);
    }

    if (columns.length > 0) {
      results.push(`**${tableName}**:\n${columns.join('\n')}\n`);
    }
  }

  const enumRegex = /CREATE\s+TYPE\s+["'`]?(\w+)["'`]?\s+AS\s+ENUM\s*\(([^)]+)\)/gi;
  while ((match = enumRegex.exec(sql)) !== null) {
    results.push(`**${match[1]}** (ENUM): ${match[2].trim()}\n`);
  }

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers for PromptBuilder vars (pre-formatting injection data)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatLessonsForPrompt(
  lessons?: Array<{ content: string; score: number; relatedFiles: string[]; tags: string[]; timestamp: string; directive?: string }>,
): string {
  if (!lessons?.length) return '';
  return lessons
    .map((l, i) => `### Lesson ${i + 1} (score: ${l.score})\n${l.content}`)
    .join('\n\n');
}

function formatSessionContextForPrompt(sessionContext?: {
  recentRuns: Array<{ runId: number; directive: string; mode: string; output: string }>;
  summary?: string;
  totalRuns: number;
  currentRun: number;
  currentMode: string;
  windowSize: number;
  compressionRatio: number;
}): string {
  if (!sessionContext || sessionContext.totalRuns === 0) return '';

  const parts: string[] = [];
  parts.push(`**Session Run ${sessionContext.currentRun}/${sessionContext.totalRuns}** (mode: ${sessionContext.currentMode})`);
  if (sessionContext.summary) {
    parts.push(`\n**Session Summary:**\n${sessionContext.summary}`);
  }
  if (sessionContext.recentRuns.length > 0) {
    parts.push('\n**Recent Runs:**');
    for (const run of sessionContext.recentRuns) {
      const truncated = run.output.length > 500 ? `${run.output.substring(0, 500)}...` : run.output;
      parts.push(`- Run ${run.runId} (${run.mode}): ${run.directive}\n  Output: ${truncated}`);
    }
  }
  return parts.join('\n');
}

