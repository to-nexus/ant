/**
 * Decompose Node (Refactored)
 * 
 * Meta-level planning: Break the overall task into executable tasks
 * This runs ONCE at the beginning to create the initial task queue.
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - validation.ts: Task validation logic
 * - sessionManager.ts: Session restore/save logic
 * - designSelector.ts: Design document selection (environment-aware)
 * - llmCaller.ts: LLM prompt building and calling
 * - responseParser.ts: Parse LLM response into tasks
 */

import { LLMClient } from "../../../../../../core/ports";
import { extractLLMInfo } from "../../../../../../core/ports/workflow";
import { ArchitectGraphState, basePriorityFor } from "../../state";
import { renderPriorityBandGuide } from "../../state.priorityGuide";
import { BOUNDARY, SUGGESTED_BOUNDARY, resolveTaskTechTierFromStack, applyExplicitTechTierOverrides, applyExplicitGameArtTierOverrides, getTechTier, type Boundary, type TechTierConfig, SURFACE_SYSTEM_VARIANTS, SPATIAL_SYSTEM_VARIANTS, getVisualLanguagesWithModes, isTierActive, getEffectiveDomain, getConfigSlots, GAME_ART_CONCEPT_VARIANTS, GAME_ART_PERSPECTIVE_VARIANTS, getGameArtConceptsWithPerspectives, SUPPORTED_GAME_ENGINES, isClarifyActive, getClarifyPolicy } from "@ant/shared";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { logErrorHeader } from "../_common/errorHandler";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { TEMPLATE_PATHS } from "../../../../../../core/prompt/builder/templatePaths";
// ArtifactService no longer needed — metadata extracted from state.artifacts
import { getEstimatingLabel } from "../../../../../common/graph/timing/estimatingLabels";

// Import submodules
import {
  validateTasks,
  validateTaskTypeEnum,
  validateTaskDescriptions,
  validateTierTaskShape,
  InvalidTaskTypeViolation,
  buildInvalidTaskTypeViolationFraming,
  MissingTaskDescriptionViolation,
  buildMissingTaskDescriptionViolationFraming,
  TierShapeViolation,
  buildTierShapeViolationFraming,
} from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareRacInjection } from "./designSelector";
import { CODEBASE_WALK_IGNORE } from "../../../../../../core/codebase/walkIgnore";
import { callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, parseTaskItemJson, createTaskQueue, logTaskSummary, deriveBandFromPriority, MissingTasksTagViolation, buildMissingTasksTagViolationFraming } from "./responseParser";
import { computeRacScope } from "./racGate";
import { saveAnalysisForDebug } from "./saveAnalysisText";
import type { BaseTask, TaskType, IntentId } from "@ant/shared";
import type { CodeTask } from "../../../../types/task";
import {
  ExecutionTierId,
  validateExecutionTier,
  ExecutionTierViolation,
  buildExecutionTierViolationFraming,
  recordUserTurnMeta,
  parseExecutionTierTag,
} from "../../../../../../core/executionTier";
import {
  isIntentCommitted,
  buildIntentClarifyTemplateVars,
  applyClarifyGate,
  parseClarifyTags,
  type ClarifyGateResult,
} from "../../../../../common/clarify";
import { referenceCatalogVars } from "../../../../../common/tool/reference/catalogVars";
import { containsRuntimeErrorPattern } from "../../../../../../core/utils/runtimeErrorPattern";
import { projectLens } from "../../../../../../core/context/lensProjection";
import { contextProfileFor } from "../../../../../../core/executionTier/contextProfile";
import { effectiveAssetInventory } from "../../../../../../infrastructure/workspace/assetInventory";
import {
  JsonSyntaxViolation,
  buildJsonSyntaxViolationFraming,
} from "../../../../../../core/utils/llmResponseParser";
import * as fs from "fs";
import * as path from "path";

/**
 * Deterministic gameArtTier.perspective observer — the codebase manifests
 * are the SSOT (ProjectProfileDetector pattern): `enable3d` in
 * package.json IS the 3D signal (it layers three.js/ammo.js onto the
 * Phaser host), plain `phaser` without it is 2D. Outranks stored/emitted
 * values in the STEP 6.65 merge (an LLM inference can't flip the render
 * path of an existing codebase — focal-molding-board's 2d→3d flip);
 * explicit user wizard choice still wins above it. Greenfield / non-game
 * codebases yield `undefined` (no signal).
 */
export function observePerspectiveFromCodebase(
  featurePath: string | undefined,
): '2d' | '3d' | undefined {
  if (!featurePath) return undefined;
  try {
    const pkgPath = path.join(featurePath, 'codebase', 'package.json');
    if (!fs.existsSync(pkgPath)) return undefined;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps['enable3d'] || deps['@enable3d/phaser-extension']) return '3d';
    if (deps['phaser']) return '2d';
    return undefined;
  } catch {
    return undefined;
  }
}


/**
 * Decompose Node - Main Entry Point
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('decompose', state._uiLocale), 'decompose');
  }

  // Seed chat-input gauge snapshot so in-flight usage_partial events from the
  // decompose LLM stream have a target to overwrite. Without this seed,
  // `maybeUpdatePhaseTokenUsage` inside the stream loop is a silent no-op and
  // the gauge only updates after `applyEstimatingUsage` runs at stream end.
  const { beginNodePhase } = await import('../../../../../common/graph/llmHelpers');
  beginNodePhase(state, 'decompose', getEstimatingLabel('decompose', state._uiLocale));
  
  // Increment recursion count
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'decompose', 
      0,
      taskInfo, 
      llm ? extractLLMInfo(llm) : undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 DECOMPOSE: Breaking down specification into tasks');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Check for existing session (resume support)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const sessionCheck = await checkSessionRestore(state);
  
  if (sessionCheck.shouldRestore && sessionCheck.session) {
    if (sessionCheck.hasAdditionalDirective) {
      // Replan: merge directives and decompose
      console.log('🔄 [Decompose] Replan mode: merging directives and re-decomposing');
      state = {
        ...state,
        directive: sessionCheck.mergedDirective,
        completedTasks: sessionCheck.session.state?.completedTasks || [],
        completedTasksDetails: sessionCheck.session.state?.completedTasksDetails || [],
        referenceRequests: sessionCheck.session.state?.referenceRequests || [],
        retries: 0,
        previousAttempts: [],
        enforcementHistory: [],
        resolvedCategories: []
      } as any;
      
      (state as any)._replanJobId = sessionCheck.session.state?.jobId;
      (state as any)._replanJobTiming = sessionCheck.session.state?.jobTiming;
      
      // Fall through to decomposition
    } else {
      // Normal resume
      return restoreFromSession(state, sessionCheck.session);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Codebase file listing (fileSystem-based)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let codebaseFilePaths: string[] | undefined;

  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Prepare RAC artifact injection (compact ↔ decompact)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Single SSOT for decompose's artifact-derived template variables. Refs
  // and context flow through `compactArtifacts` (role-scoped thresholds +
  // grand-total demotion), then split into:
  //   - `documents` / `hasDocuments`           — design-doc-guide partial
  //   - `refArtifacts` / `contextArtifacts`    — base.md "Provided Documents"
  //   - `hasCompactedArtifacts`                — gates rules.md reading-strategy
  // No artifact content is ever truncated; oversized docs become outlines
  // the LLM can re-expand via `read_file(path, startLine, endLine)`.
  const racInjection = prepareRacInjection(state);
  const {
    documents,
    hasDocuments,
    refArtifacts,
    contextArtifacts,
    hasGenericArtifacts,
    hasCompactedArtifacts,
  } = racInjection;

  // Inter-Job Context Bridge: pre-determine boundary classification
  const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
  const pool = new ArtifactPoolView(state.artifacts || []);
  const suggestedBoundary =
    state.resolvedAction?.mode === 'explain' ? SUGGESTED_BOUNDARY.LIGHTWEIGHT
    : hasDocuments ? SUGGESTED_BOUNDARY.HEAVYWEIGHT
    : pool.hasSpec() ? SUGGESTED_BOUNDARY.PENDING
    : SUGGESTED_BOUNDARY.LIGHTWEIGHT;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!state.deps?.promptBuilder) {
    throw new Error('[Decompose] PromptBuilder not available');
  }
  
  // Detect project code inside the feature's `codebase/` scope (Vector DB may be empty
  // when the user hasn't run `ant index` yet). A single fileSystem.listFiles call
  // drives both the hasProjectCode heuristic and the codebaseFilePaths fallback,
  // so both observations share the same scope.
  let hasProjectCode = false;
  const fsPort = state.deps?.fileSystem;
  if (fsPort) {
    try {
      const allFiles = await fsPort.listFiles('codebase', [...CODEBASE_WALK_IGNORE]);

      // listFiles returns paths relative to the feature root (e.g. "codebase/src/foo.ts").
      // Normalize to codebase-relative for rule matching.
      const codebasePrefix = 'codebase/';
      const relFiles = allFiles.map(p => p.startsWith(codebasePrefix) ? p.slice(codebasePrefix.length) : p);

      const sourceDirs = new Set(['src', 'lib', 'app', 'cmd', 'internal', 'services']);
      const configFiles = new Set([
        'package.json',
        'go.mod', 'go.work',
        'Cargo.toml',
        'pyproject.toml', 'requirements.txt',
        'pom.xml', 'build.gradle', 'build.gradle.kts',
      ]);

      let hasSourceDir = false;
      let hasConfigFile = false;
      for (const rel of relFiles) {
        const slashIdx = rel.indexOf('/');
        if (slashIdx > 0) {
          const firstSeg = rel.slice(0, slashIdx);
          if (!hasSourceDir && sourceDirs.has(firstSeg)) hasSourceDir = true;
        } else if (!hasConfigFile && configFiles.has(rel)) {
          hasConfigFile = true;
        }
        if (hasSourceDir && hasConfigFile) break;
      }

      hasProjectCode = hasSourceDir || hasConfigFile;
      console.log(`   ${hasProjectCode ? '✅' : '❌'} [Decompose] Project code exists: ${hasProjectCode} (hasSourceDir=${hasSourceDir}, hasConfigFile=${hasConfigFile})`);

      if (hasProjectCode && (!codebaseFilePaths || codebaseFilePaths.length === 0)) {
        codebaseFilePaths = relFiles;
        console.log(`   ✅ [Decompose] Loaded ${relFiles.length} files via fileSystem.listFiles('codebase')`);
      }
    } catch (error) {
      console.warn(`⚠️  [Decompose] Failed to probe codebase via fileSystem.listFiles:`, error);
      hasProjectCode = false;
    }
  }
  
  // ✅ Extract metadata from artifact pool via ArtifactPoolView.
  //
  // Post-RAC SSOT: templates read role-scoped flags ONLY (see
  // `AGENTS.md` "Post-RAC Template Condition SSOT"). Role-agnostic
  // "availability meta" blocks (uiSectionsSummary / designDocsMeta /
  // uiHint) were removed — the pool already injects those documents
  // via role-annotated sections in the prompt, so re-listing paths
  // was duplicate context.
  //
  // Generic ref/context artifact filtering (system-design / spec / ui
  // exclusion) and per-role compaction are owned by `prepareRacInjection`
  // above — we consume the result directly to avoid a second filter pass.
  if (hasGenericArtifacts) {
    const totalChars = [...refArtifacts, ...contextArtifacts].reduce(
      (s, a) => s + (a.content?.length || 0),
      0,
    );
    console.log(
      `📄 [Decompose] Generic artifacts: ${refArtifacts.length} ref(s) + ` +
      `${contextArtifacts.length} context(s), ${totalChars.toLocaleString()} chars` +
      (hasCompactedArtifacts ? ' (some compacted)' : ''),
    );
  }

  // Tier-classification signal: a compact summary of every ref (not just
  // generic refs) so the LLM can weigh Tier 3 (no refs / refs-unrelated)
  // vs Tier 4 (refs-grounded). The full content of these refs is already
  // injected elsewhere in this prompt (spec / system designs / ui docs
  // / generic refs); this block only surfaces the path list so the tier
  // classifier does not have to scan the whole prompt to know refs exist.
  const tierRefs = pool.all
    .filter(a => a.role === 'ref' && a.content?.trim())
    .map(a => {
      const path = a.path;
      const basename = path.slice(path.lastIndexOf('/') + 1) || path;
      const label = basename.replace(/\.md$/i, '');
      return { path, label };
    });

  // Active spec ref is determined by the RAC (upstream intent + user
  // selection). The decompose LLM does NOT re-pick a spec — that was the
  // legacy `<selectedSpec>` behavior.
  const activeSpecRefFilename = pool.activeSpecRefFilename();

  // Source-aware gate (RAC-leak Channel A/B closure). When the user pins
  // `resolvedAction` via ActionsPanel / @-mention, the RAC is the SSOT for
  // every artifact this turn — discovery tools must not side-load files
  // outside refs/context, and decompose's `packages → fe-system-X.md`
  // auto-mapping is suppressed (see `state.artifacts Post-RAC SSOT` in
  // `AGENTS.md` and the `discovery-tool RAC bypass (2026-04)` regression). Empty RAC
  // (`hasExplicitFields=false` OR refs+context both empty) falls through
  // to the legacy infer behaviour because the LLM legitimately needs to
  // discover anchors when the user hasn't pre-selected any.
  const _racRefs = state.resolvedAction?.refs ?? [];
  const _racContext = state.resolvedAction?.context ?? [];
  const isExplicitPipeline =
    state.resolvedAction?.source === 'explicit'
    && (state.resolvedAction?.hasExplicitFields ?? false)
    && (_racRefs.length + _racContext.length > 0);

  // Detect error indicators in directive for error-or-general template activation.
  // Single source of truth: `core/utils/runtimeErrorPattern`.
  const hasErrorInDirective = containsRuntimeErrorPattern(state.directive);

  const decomposeVars = {
    directive: state.directive || '',
    documents,
    hasDocuments,
    refArtifacts,
    contextArtifacts,
    hasGenericArtifacts,
    hasCompactedArtifacts,
    tierRefs,
    mode: state.resolvedAction?.mode || 'unknown',
    techTier: getTechTier(state),
    codebaseFilePaths,
    hasProjectCode,
    // Domain pool ∪ attached binaries (see `effectiveAssetInventory`) — a file's
    // directory must not decide whether decompose is told it exists.
    assetInventory: effectiveAssetInventory(state),
    hasErrorInDirective,
    needsBoundaryClassification: suggestedBoundary === SUGGESTED_BOUNDARY.PENDING,
  };
  
  if (!state.deps.promptBuilder) throw new Error('[Decompose] PromptBuilder not available');

  const hasExistingCode = decomposeVars.hasProjectCode ?? 
    (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0);
  const fileList = (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0)
    ? decomposeVars.codebaseFilePaths.map((f: string) => `- ${f}`).join('\n') : '';
  const assetsHint = decomposeVars.assetInventory && decomposeVars.assetInventory.count > 0
    ? `\n\n## Available Assets\nThere are ${decomposeVars.assetInventory.count} real asset file(s) on disk — the asset pool plus any file attached to this turn. Paths are feature-relative.\nDo NOT add a dedicated "copy assets" task. The ui/feature task that actually needs an asset copies it into the app's static-asset root (framework-aware) and references it — placement + wiring happen inside that task's plan/execute.\nAsset file list (first 50):\n${decomposeVars.assetInventory.files.slice(0, 50).map((f: string) => `- ${f}`).join('\n')}\n`
    : '';
  // Gate flag — decompose activates design-system task guidance
  // whenever ANY UI artifact (ref or context) is present in the
  // post-RAC pool. The intent matrix assigns UI=ref for `gen-code-sys`
  // but UI=context for `gen-code-spec` (see
  // `@ant/shared/action-config-matrix.ts`); both must trigger the same
  // decomposition rules (design-system ladder, uiSections schema),
  // otherwise the latter intent regresses into missing guidance.
  // See `AGENTS.md` "Post-RAC Template Condition SSOT".
  const hasUi = pool.hasUi();

  // Functional meta — UI section IDs inform the LLM's per-task `include`
  // authoring (e.g. `visual/ui/ant/spec/<id>`). Full content is NOT embedded
  // here; plan/execute select sections per task via `include`.
  //
  // ID = basename — fine for all three UiSource prefixes
  // (`visual/ui/{ant,figma,handoff}/…`).
  const uiArtifactPaths = pool.ui.map(a => ({
    id: a.path.split('/').pop() ?? a.path,
    role: a.role,
  }));

  // Discriminate which of the three UiSource kinds the pool carries (or null
  // when no UI source was selected). Downstream prompts (decompose / plan /
  // execute) dispatch on `uiSource` to pick the correct interpretation
  // partial (ui-source-ant / figma / handoff). Hard-exclusive by
  // construction — `pool.uiSource()` throws on mixed sources.
  const uiSource = pool.uiSource();

  // Phase 1: matrix-driven tier flags. Templates read these instead of
  // domain-name comparisons (Domain-Branching Locality I1).
  const _decomposeSlot = state.resolvedAction?.intent
    ? getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const _effectiveDomain = getEffectiveDomain(state.resolvedAction?.domain);
  const _runtime = { techTier: state.resolvedAction?.basis?.techTier, hasUiDoc: hasUi };

  // Phase 1 — decision-tag emit candidates. Templates use these via
  // `{{{xCandidates}}}` so the LLM sees the matrix-allowed value list
  // without us needing to name the domain inside the template (D6 / I1).
  const _gameEngineEnabled =
    _effectiveDomain === 'game' &&
    isTierActive('techTier', _decomposeSlot, _effectiveDomain, _runtime);
  const _gameArtTierEnabled = isTierActive('gameArtTier', _decomposeSlot, _effectiveDomain, _runtime);

  // Defensive normalization of `state.resolvedAction.documents` entries so
  // any `action-context` partial render reached via this entry point (sub-
  // render, cache warming) finds `{label, path, content}` populated and
  // does not trip the FilePromptAdapter `missingVars` validator. The
  // `AutoInjectionResolver` performs the same normalization, but the two
  // entry points can run independently, so we mirror it here. We only
  // touch the `documents` array — `resolvedAction` itself is not replaced.
  const _racDocs = (state.resolvedAction as { documents?: Array<Record<string, unknown>> } | undefined)?.documents;
  if (Array.isArray(_racDocs)) {
    for (const entry of _racDocs) {
      if (entry && typeof entry === 'object') {
        if (entry.label === undefined || entry.label === null) entry.label = '';
        if (entry.path === undefined || entry.path === null) entry.path = '';
        if (entry.content === undefined || entry.content === null) entry.content = '';
      }
    }
  }

  // Reference-codebase catalog (cross-project code exploration). Lists sibling
  // ANT projects in the tenant so the LLM can register one via `<references>`
  // (pre-seed) or `register_reference` (runtime). Empty when no siblings exist.
  const { referenceCatalog, hasReferenceCatalog } = await referenceCatalogVars(state);

  // Clarify guidance vars — surface budget/mode to the gated clarify-policy
  // partial in decompose rules.md. Tier is unknown at prompt-build time (the
  // LLM emits it), so the prompt-level gate uses enabled+phase+budget only;
  // the runtime `applyClarifyGate` applies the tier floor precisely.
  const _clarifyIntentForPrompt = (state.actionMetadata?.intent ?? state.resolvedAction?.intent) as
    | IntentId
    | undefined;
  const _clarifyActive = !!_clarifyIntentForPrompt && isClarifyActive(_clarifyIntentForPrompt, 'decompose');
  const _clarifyPolicy = _clarifyIntentForPrompt ? getClarifyPolicy(_clarifyIntentForPrompt) : undefined;

  const enrichedVars = {
    ...decomposeVars,
    // Context Lens P2 — standard profile (decompose decides the tier, so it
    // cannot condition on it; runs once per job). Assistant finals + digests
    // let task breakdown honor referents settled in chat ("옵션 B로 하자").
    lens: projectLens(state.featureContext, contextProfileFor('decompose')),
    clarifyActive: _clarifyActive,
    clarifyBudget: _clarifyPolicy?.clarifyBudget,
    blockingMode: _clarifyPolicy?.blockingMode,
    referenceCatalog,
    hasReferenceCatalog,
    hasExistingCode, fileList, fileCount: decomposeVars.codebaseFilePaths?.length || 0,
    hasErrorInDirective: decomposeVars.hasErrorInDirective || false,
    // Response-language SSOT — gated `jobs/code/base/injections/response-language`
    // partial included at top of `decompose/variants/default/base.md`.
    // Drives the gate that lets `<tasks>` JSON values (`name`, `description`)
    // come out in the user's language instead of being silently overridden
    // to English by the legacy directive in `jobs/code/base/system.md`.
    //
    // `??` (not `||`) so an explicitly-set empty string would still fall
    // through to the 'en' fallback only when truly nullish. `state.context`
    // is optional-chained because some entry points (cache warming,
    // partial sub-renders) may invoke decompose-derived variable builds
    // before `context` is initialized.
    userLanguage: state.context?.userLanguage ?? 'en',
    // Codebase Channel SSOT — surface workspace state to the codebase-channel
    // partial (PromptBuilder.render auto-derives codebaseRole from this).
    workspaceState: state.workspaceState,
    // RAC-source gate — templates suppress `packages → fe-system-X.md`
    // mapping and design-doc cross-cutting guidance when the user has
    // explicitly pinned the RAC. See `AGENTS.md` "state.artifacts
    // Post-RAC SSOT" (Channel B suppression).
    isExplicitPipeline,
    hasUi,
    // Gate for the Design Document Authority guide (system-design-guide).
    // Port partition is decided at decompose (foundation / port tasks), so
    // the two-axis authority must reach this phase, not only plan.
    hasSystemDesign: pool.hasSystemDesign(),
    uiSource,
    uiArtifactPaths,
    documents: decomposeVars.documents || [], hasDocuments: decomposeVars.hasDocuments || false,
    assetsHint,
    resolvedAction: state.resolvedAction,
    visualTierActive: isTierActive('visualTier', _decomposeSlot, _effectiveDomain, _runtime),
    // D23 + D27: 'domain' is not a TierKey — it is the workspace selector
    // above the tier set (D22). Templates at `templates/domain/{d}.md` and
    // `templates/jobs/{job}/domain/{d}.md` are layered by
    // `PromptBuilder.renderDomainTier` outside the tier loop. The
    // `domainTierActive` flag is kept as a truthy guard for downstream
    // template forks that want to know "is a domain resolved at all?"
    // without inspecting `domain` directly.
    domainTierActive: !!_effectiveDomain,
    gameArtTierActive: _gameArtTierEnabled,
    // §4 — gate the `<serviceVirtualization>` opt-out teaching/emission to
    // service-domain jobs (game uses the game-art surface, not SV). Keeps the
    // domain comparison in code, not the template (Domain-Branching Locality I1).
    serviceVirtualizationTagActive: _effectiveDomain === 'service',
    availableVisualLanguagesWithModes: getVisualLanguagesWithModes(),
    availableSurfaceSystems: SURFACE_SYSTEM_VARIANTS.join(', '),
    availableSpatialSystems: SPATIAL_SYSTEM_VARIANTS.join(', '),
    // Decision-tag candidate JSON literals. Empty (undefined) when the
    // tier is matrix-gated off so `{{#if xCandidates}}` blocks vanish.
    gameEngineCandidates: _gameEngineEnabled
      ? JSON.stringify(SUPPORTED_GAME_ENGINES)
      : undefined,
    gameArtConceptCandidates: _gameArtTierEnabled
      ? GAME_ART_CONCEPT_VARIANTS.map((v: string) => `\`${v}\``).join(', ')
      : undefined,
    // Concept ids annotated with the render perspective(s) each supports —
    // used by the game-art-tier-detection partial to constrain the perspective
    // pick to what the chosen concept supports.
    gameArtConceptsWithPerspectives: _gameArtTierEnabled
      ? getGameArtConceptsWithPerspectives()
      : undefined,
    gameArtPerspectiveCandidates: _gameArtTierEnabled
      ? GAME_ART_PERSPECTIVE_VARIANTS.map((v: string) => `\`${v}\``).join(', ')
      : undefined,
    specClarifyBypassed: state._specClarifyBypassed === true,
    // Canonical priority band guide, rendered from the `TASK_PRIORITY` map
    // (single SSOT — no hand-copied band table). All code intents use the
    // same canonical bands: priority is purely the queue ordering key, while
    // band placement follows dependency classification. A source document's
    // stated order (spec / system design) is a WITHIN-band reference only.
    priorityBandGuide: renderPriorityBandGuide(),
    // Intent-level clarify gate. `<specClarify>` re-adjudicates the
    // active intent (redirect_to_design = job switch, proceed_without_spec
    // = skip source contract) and MUST NOT fire when the upstream
    // pipeline has already committed to an intent — whether via
    // ActionsPanel "Start via Chat" (source='explicit') or via @-mention
    // that populates `actionMetadata.intent`. See
    // `agents/common/intentCommit.ts` for the SSOT predicate.
    ...buildIntentClarifyTemplateVars(state),
  };
  const decomposeSystem = await state.deps.promptBuilder.render(TEMPLATE_PATHS.codeDecompose.rules!, enrichedVars);
  // Entry-point ownership — per-framework, node-scoped injection. decompose has
  // no Tier A, so framework basis (the file-per-route vs shared-registry
  // ownership SSOT) is NOT auto-injected here. Render the active FE/BE
  // frameworks' decompose-perspective entry-point guidance and prepend it so
  // the task breakdown knows who owns per-unit vs host entries.
  // 6A reachability for these `injections/framework/<fw>` templates relies on
  // `AutoInjectionResolver` listing the framework basenames (currently
  // ['nextjs','react','react-native','nestjs','gin']) — keep that array in sync
  // if the supported-framework set changes, or the invariant-audit 6A
  // classification for these templates will break.
  const _activeFrameworks = [
    state.resolvedAction?.basis?.techTier?.frontend?.framework,
    state.resolvedAction?.basis?.techTier?.backend?.framework,
  ].filter((fw): fw is string => !!fw);
  let frameworkEntryPointHints = '';
  for (const fw of _activeFrameworks) {
    try {
      const hint = await state.deps.promptBuilder.render(`jobs/code/nodes/decompose/injections/framework/${fw}`, {});
      if (hint.trim()) frameworkEntryPointHints += (frameworkEntryPointHints ? '\n\n' : '') + hint.trim();
    } catch { /* no per-framework entry-point hint for this framework — skip */ }
  }
  const decomposeSystemWithFw = frameworkEntryPointHints
    ? `${frameworkEntryPointHints}\n\n---\n\n${decomposeSystem}`
    : decomposeSystem;
  let envContract = '';
  try { envContract = await state.deps.promptBuilder.render('jobs/code/base/injections/preview-env-contract', {}); } catch { /* skip */ }
  const fullSystem = envContract ? `${decomposeSystemWithFw}\n\n---\n\n${envContract}` : decomposeSystemWithFw;
  const decomposeUser = await state.deps.promptBuilder.render(TEMPLATE_PATHS.codeDecompose.base, enrichedVars);
  // Direct-path re-entry framing (E from plan): `direct` sets
  // needsEscalation=true when a write-intent Tier 1 attempt touched no
  // files. The router (routeAfterDirect, 1-shot cap) sends us back here
  // with state.needsEscalation=true and state._promotedThisJob=false.
  // Append an assertive note to the user prompt so the LLM understands
  // the previous attempt failed and should re-classify at Tier 2+.
  //
  // Without this, the LLM's prior response is cached in the session and
  // it would likely re-emit the same Tier 1 classification, defeating
  // the escalation. The framing is orthogonal to the Tier-violation
  // retry loop below — both can stack if the re-entry attempt also
  // violates the contract.
  const isDirectEscalationReentry =
    state.needsEscalation === true && state._promotedThisJob !== true;
  const escalationFraming = isDirectEscalationReentry
    ? '\n\n---\n\n## Retry: previous direct-path attempt failed\n' +
      'Your previous classification at `<executionTier>1</executionTier>` entered the ' +
      'direct ReAct loop but touched ZERO files before its step budget expired. ' +
      'This signals the directive actually requires more than a single verification-' +
      'unneeded write — either (a) the planned write was skipped because additional ' +
      'context was needed, or (b) the work requires multiple related edits that must ' +
      'own their verification. Re-classify at `<executionTier>2</executionTier>` ' +
      '(Exploratory: exactly one task with `selfVerifyOnDone: true`) or higher.'
    : '';
  const prompts = { system: fullSystem, user: decomposeUser + escalationFraming };

  // T1 pre-call estimate. `beginNodePhase` ran at node entry so the snapshot
  // exists; seed an approximate input count now so the chat-input gauge
  // reflects prompt size immediately rather than only after the first
  // `usage_partial` event from the LLM adapter.
  const { applyEstimatedInputTokens } = await import('../../../../../common/graph/llmHelpers');
  applyEstimatedInputTokens(state, prompts.system.length + prompts.user.length);

  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'decompose',
        prompts.system.length + prompts.user.length,
        {
          templatePath: `${TEMPLATE_PATHS.codeDecompose.base} (user) + ${TEMPLATE_PATHS.codeDecompose.rules} (system)`,
          usedTemplates: [
            TEMPLATE_PATHS.codeDecompose.rules!,
            // partials included by decompose base.md — no TEMPLATE_PATHS slot
            'jobs/code/nodes/decompose/variants/default/techTier-rules',
            'jobs/code/nodes/decompose/variants/default/mode-guide',
            'jobs/code/nodes/decompose/variants/default/error-or-general',
            'jobs/code/nodes/decompose/variants/default/existing-code-check',
            'jobs/code/nodes/decompose/variants/default/design-doc-guide',
            'jobs/code/nodes/decompose/variants/default/output-unit-splitting',
          ],
          injectedVariables: {
            directive: decomposeVars.directive ? `[${decomposeVars.directive.length} chars]` : undefined,
            refArtifacts: refArtifacts.length > 0 ? `[${refArtifacts.length} file(s)]` : undefined,
            contextArtifacts: contextArtifacts.length > 0 ? `[${contextArtifacts.length} file(s)]` : undefined,
            documents: documents.length > 0 ? `[${documents.length} docs]` : undefined,
            hasCompactedArtifacts,
            racCompactionMeta: hasCompactedArtifacts
              ? {
                  refsCompactedCount: racInjection.meta.refsCompactedCount,
                  contextCompactedCount: racInjection.meta.contextCompactedCount,
                  grandTotalCharsBefore: racInjection.meta.grandTotalCharsBefore,
                  grandTotalCharsAfter: racInjection.meta.grandTotalCharsAfter,
                  artifactBudgetChars: racInjection.meta.artifactBudgetChars,
                  forcedZeroCount: racInjection.meta.forcedZeroThresholdPaths.length,
                }
              : undefined,
            hasUi,
            hasUiRef: pool.hasUiRef(),
            hasSystemDesignRef: pool.hasSystemDesignRef(),
            uiArtifactPaths: uiArtifactPaths.length,
            hasDocuments,
            mode: decomposeVars.mode,
            hasProjectCode,
            codebaseFilePaths: codebaseFilePaths?.length || 0,
            runtimeAssetsCount: decomposeVars.assetInventory?.count || 0,
            techTierLanguage: decomposeVars.techTier?.language || null,
            techTierFramework: decomposeVars.techTier?.framework || null,
            hasBasis: !!state.resolvedAction?.basis,
            hasVisualTier: !!state.resolvedAction?.basis?.visualTier,
            basisStack: state.resolvedAction?.basis?.techTier?.stack || null,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Decompose] Failed to log prompt:`, logError);
    }
  }
  
  // Content clarify is a turn-terminating `<clarify>` emission detected AFTER
  // the tool loop (STEP 4.5), replacing the former CLARIFY_TOOL. `clarifyIntent`
  // is the committed intent used to gate via the clarify-policy matrix.
  const clarifyIntent = (state.actionMetadata?.intent ?? state.resolvedAction?.intent) as
    | IntentId
    | undefined;
  let clarifyPaused: ClarifyGateResult | undefined;

  // Tier Entry Node retry contract (C-2 from plan):
  //
  //   When the LLM emits a response that violates the executionTier prompt
  //   contract (missing <executionTier> tag, or tier 0 for generate/refactor
  //   which forbids Tier 0), append a violation-specific framing to the
  //   user prompt and re-issue the call. Cap at 3 total attempts — 1
  //   initial + 2 retries. Any other parse error bypasses the retry loop
  //   and throws immediately.
  //
  // Token/gauge accounting is idempotent across retries:
  //   - `beginNodePhase` (seeded at node entry) no-ops on re-entry for the
  //     same phase; `applyEstimatingUsage` re-seeds only when absent.
  //   - `accumulateTokenUsage(jobLevel:true)` is cumulative, so retry
  //     cost is billed correctly.
  //   - `currentPhaseTokenUsage` is overwritten each call, so the chat
  //     gauge settles on the final attempt's numbers.
  //
  //   See `packages/ant-cli/src/agents/common/graph/llmHelpers.ts` for the
  //   invariants.
  const MAX_ATTEMPTS = 3;
  const originalUserPrompt = prompts.user;
  let rawResponse: string = '';
  let decomposeTokenUsage: any;
  let parsed: ReturnType<typeof parseLLMResponse> | undefined;
  let executionTier: ExecutionTierId | undefined;
  let attempt = 0;
  // Phase 1 M-2 / D1 — share the retry-loop's decision-tag parse result
  // with STEP 6.65 below so the response body is parsed exactly once.
  type DecisionTagsResult = Awaited<ReturnType<
    typeof import('../../../../../../core/llm-response/DecisionTagRegistry')['parseDecisionTags']
  >>;
  let decisionTagsAtFinal: DecisionTagsResult | undefined;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Streaming Kanban broadcast — task-by-task during the LLM stream.
  //
  // The XMLStreamParser surfaces every `<task>...</task>` element as a
  // `task_added` action, which the llmCaller forwards here via
  // `onTaskParsed`. We accumulate a minimal `BaseTask` per task and call
  // the kanbanUpdate port so the todo column fills one at a time. This
  // is purely a UI presentation concern — the canonical `taskQueue` is
  // built later by `createTaskQueue(parsed.tasks, ...)` and overwrites
  // anything the partial broadcasts placed on the board.
  //
  // On retry the accumulator and live Kanban snapshot must be reset
  // (the next attempt will produce a fresh stream of `<task>` elements).
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let accumulatedTasks: BaseTask[] = [];
  const broadcastAccumulated = (): void => {
    const broadcaster = state.deps?.kanbanUpdate;
    if (!broadcaster || !state._httpJobId) return;
    broadcaster.updateTaskQueue(
      state._httpJobId,
      null,
      accumulatedTasks,
      [],
      state.recursionCount,
      state.recursionLimit,
      undefined,
    );
  };
  const resetAccumulated = (): void => {
    if (accumulatedTasks.length === 0) return;
    accumulatedTasks = [];
    // Broadcast the cleared state so UI drops any task cards rendered
    // during the previous (now-discarded) attempt before the next stream
    // starts emitting fresh `<task>` elements.
    broadcastAccumulated();
  };
  const onTaskParsed = (rawJson: string): void => {
    let raw: any;
    try {
      raw = parseTaskItemJson(rawJson);
    } catch {
      // Partial / malformed JSON inside a single `<task>` — skip the
      // partial broadcast. The end-of-stream `parseLLMResponse` will
      // throw on the same body and the retry loop will re-issue.
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined;
    const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : undefined;
    if (!id || !name) return;
    // Dedupe by id within the same attempt — guards against the rare
    // case where a network retry inside the tool-use loop replays the
    // same `<tasks>` block and our parser observes the same `<task>`
    // twice. Whole-attempt resets are owned by `resetAccumulated()`.
    if (accumulatedTasks.some(t => t.id === id)) return;
    const type: TaskType = typeof raw.type === 'string' ? raw.type as TaskType : 'feature';
    // Missing priority → the task type's default-window base (same SSOT helper
    // the canonical `createTaskQueue` path uses, so streaming card sort keys
    // match the final queue).
    const priority = typeof raw.priority === 'number' ? raw.priority : basePriorityFor(type);
    const description = typeof raw.description === 'string' ? raw.description : '';
    const stack: 'frontend' | 'backend' | undefined =
      raw.stack === 'frontend' || raw.stack === 'backend' ? raw.stack : undefined;
    const exclusive = typeof raw.exclusive === 'boolean' ? raw.exclusive : undefined;
    const parallelGroup = typeof raw.parallelGroup === 'string' ? raw.parallelGroup : undefined;
    // Three-Axis SSOT: derive `band` for streaming feature cards via the same
    // `deriveBandFromPriority` the canonical `createTaskQueue` uses, so the band
    // badge appears as cards stream in (not only once the final queue overwrites
    // the board). band lives on feature (foundation/platform/integration) and
    // setup ('root' for the SETUP_PROJECT root setup) — conditional spreads,
    // narrowed so each variant only carries the bands legal for its type.
    const band = type === 'feature' || type === 'setup' ? deriveBandFromPriority(priority) : undefined;
    const minimal: BaseTask = {
      id,
      name,
      type,
      priority,
      description,
      ...(stack && { stack }),
      ...(exclusive !== undefined && { exclusive }),
      ...(parallelGroup && { parallelGroup }),
      ...(type === 'feature' && band !== undefined && band !== 'root' ? { band } : {}),
      ...(type === 'setup' && band === 'root' ? { band } : {}),
    };
    accumulatedTasks = [...accumulatedTasks, minimal];
    console.log(`📋 [Decompose] Streaming task → Kanban: ${id} (${type}, p${priority})`);
    broadcastAccumulated();
  };

  while (true) {
    attempt++;
    resetAccumulated();

    try {
      // Decompose's discovery tools are now the SAME `read_file` /
      // `list_files` the entire workspace tool surface uses — the
      // dedicated `discoveryTools` fork (with its own `scope: 'artifact'
      // | 'codebase'` enum, its own `resolveAndValidate` traversal
      // gate, and its own raw-path emission) was deleted in favor of
      // `common/tool/handlers/*` + `normalizeToCodebasePath` SSOT.
      //
      // Three pieces wire it together:
      //   1. Tool schemas come from `ARCHITECT_TOOLS` (single LLM
      //      contract across decompose / worker / direct).
      //   2. `ToolExecutionContext` is built from `state.deps` like every
      //      other tool callsite. We pass a SILENT `chatStatus` here so
      //      the per-call `addReadingFile` / `addReadComplete` cards
      //      come from sourceSelector's tool loop (the existing UI
      //      surface) instead of double-emitting.
      //   3. RAC whitelist is wrapped around the common handler — it's
      //      decompose-specific (worker tools have no RAC) so it stays
      //      out of the common handler. Sibling-tree paths (plan/,
      //      architecture/, ...) are gated; codebase/ paths are
      //      orthogonal, matching the original `scope === 'artifact'`
      //      contract (`discovery-tool RAC bypass (2026-04)` regression invariant).
      const { ARCHITECT_TOOLS } = await import('../../../../../common/tool/toolSchemas');
      const { handleReadFile, handleListFiles, handleExplore } = await import('../../../../../common/tool/handlers');
      const { decideRacGate } = await import('./racGate');
      const racScope = computeRacScope(state.resolvedAction);

      // Silent chatStatus — sourceSelector.callLLMWithToolLoop owns
      // the UI emission for every tool call in the loop (one card per
      // `tc.input.path`, merged through `_mergeIndex: cardId`).
      // Forwarding the common handler's emission through the real
      // ChatAPIClient would double the cards. Commit 3 of this RCA
      // chain rewrites sourceSelector's emission to use the normalized
      // path instead of `tc.input.path` raw — the silent proxy stays.
      const silentChatStatus = new Proxy({}, { get: () => async () => undefined }) as any;

      const ctx: any = {
        fileSystem: state.deps?.fileSystem,
        chatStatus: silentChatStatus,
        workingDir: state.context?.featurePath || process.cwd(),
        featurePath: state.context?.featurePath,
        project: state.context?.project,
        featureFolder: state.context?.featureFolder,
        command: state.deps?.command,
        git: state.deps?.git,
        redis: state.deps?.redis,
        workspaceResolver: state.deps?.workspaceResolver,
        userId: state.context?.userId,
        organizationId: state.context?.organizationId,
        activePhase: 'plan',
      };

      // Explore-subagent seam for the inline loop. Child reads pass the SAME
      // racScope gate as the inline toolHandler below (symmetric 2-site RAC
      // policy). Reports are drained between rounds / joined before the final
      // decompose response via the loop hooks.
      const { createSubagentSeam, buildReportBlocks: buildSubReportBlocks, foldSubagentUsage } =
        await import('../../../../../common/subagent');
      const { collectCompleted: collectCompletedSubs, hasPending: hasPendingSubs, joinAll: joinAllSubs } =
        await import('../../../../../common/subagent/registry');
      const { TOOL_SETS } = await import('../../../../../common/tool/toolCatalog');
      const { getToolsByNames } = await import('../../../../../common/tool/toolSchemas');
      const { createCodeToolRegistry } = await import('../../../../../common/tool/presets');
      const subagentSeam = createSubagentSeam({
        jobId: state._httpJobId,
        jobKind: 'code',
        llmJobType: 'code',
        workspaceConfig: state.workspaceConfig,
        baseCtx: ctx,
        gate: (call) => {
          if (call.name !== 'read_file' && call.name !== 'list_files') return { allowed: true };
          const target = ((call.args as any)?.path ?? (call.args as any)?.directory ?? '') as string;
          return decideRacGate(target, racScope);
        },
        registry: createCodeToolRegistry(),
        childTools: getToolsByNames(TOOL_SETS.subagentCode),
        promptBuilder: state.deps?.promptBuilder,
      });
      ctx.subagent = subagentSeam;
      const drainSubagents = async (): Promise<any[]> => {
        const completed = collectCompletedSubs(subagentSeam.ownerKey);
        if (completed.length === 0) return [];
        const tokenDelta = await foldSubagentUsage(state as any, completed);
        void tokenDelta; // decompose token channels ride state mutation + applyEstimatingUsage; node return carries them via state
        return buildSubReportBlocks(completed);
      };

      const allTools = [ARCHITECT_TOOLS.read_file, ARCHITECT_TOOLS.list_files, ARCHITECT_TOOLS.explore];
      const result = await callLLMForDecompose(llm, prompts, state.workspaceConfig, {
        tools: allTools,
        toolHandler: async (name, args, callId) => {
          // RAC gate. `decideRacGate` derives codebase vs sibling from
          // the same `normalizeToCodebasePath` SSOT every other tool
          // callsite uses, replacing the deleted discoveryTools' explicit
          // `scope === 'artifact'` enum check. `explore` carries no artifact
          // path itself — its child reads pass the same gate via the seam.
          if (name !== 'explore') {
            const target = (args.path ?? args.directory ?? '') as string;
            const gate = decideRacGate(target, racScope);
            if (!gate.allowed) return `Error: ${gate.error}`;
          }

          let res;
          if (name === 'read_file') {
            res = await handleReadFile(ctx, args as { path: string; startLine?: number; endLine?: number });
          } else if (name === 'list_files') {
            res = await handleListFiles(ctx, args as { directory?: string; pattern?: string });
          } else if (name === 'explore') {
            ctx.currentToolCallId = callId;
            res = await handleExplore(ctx, args);
          } else {
            return `Error: Unknown tool "${name}"`;
          }
          // ToolResult.content is `string | any[]` (the array branch is a
          // figma multimodal-block carve-out). decompose's tool loop is
          // text-only — coerce to string so the LLM sees a stringified
          // payload if the array case ever lands here.
          return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
        },
        state,
        onTaskParsed,
        betweenRounds: drainSubagents,
        beforeFinalReturn: async () => {
          if (!hasPendingSubs(subagentSeam.ownerKey)) {
            const leftovers = await drainSubagents();
            return leftovers.length > 0 ? leftovers : null;
          }
          console.log(`⏳ [Decompose] Join barrier: waiting for pending explore(s)`);
          await joinAllSubs(subagentSeam.ownerKey);
          const blocks = await drainSubagents();
          return blocks.length > 0 ? blocks : null;
        },
      });
      rawResponse = result.response;
      decomposeTokenUsage = result.tokenUsage;

      if (decomposeTokenUsage) {
        const { applyEstimatingUsage } = await import('../../../../../common/graph/llmHelpers');
        applyEstimatingUsage(state, 'decompose', decomposeTokenUsage, {
          promptChars: prompts.system.length + prompts.user.length,
          modelId: result.modelId,
        });
      }
    } catch (error) {
      logErrorHeader('Decompose');
      console.error(error);
      throw error;
    }

    // Content clarify (turn-terminating `<clarify>`) — check BEFORE
    // parseLLMResponse so a clarify-only response (no `<tasks>`/`<executionTier>`)
    // does not trip the tier/task validators. This is the pre-fan-out gate:
    // decompose is single-threaded, so pausing here never freezes a live queue.
    if (clarifyIntent && parseClarifyTags(rawResponse).length > 0) {
      const gate = await applyClarifyGate({
        responseText: rawResponse,
        intent: clarifyIntent,
        phase: 'decompose',
        tier: parseExecutionTierTag(rawResponse),
        clarifyRoundsUsed: state.clarifyRoundsUsed,
      });
      if (gate.paused) {
        clarifyPaused = gate;
        break;
      }
      // Gate declined (inactive here / budget exhausted): reframe + retry so
      // the LLM proceeds to emit tasks instead of dead-ending on a stripped
      // clarify. Falls through to parseLLMResponse on the last attempt.
      if (gate.proceedNote && attempt < MAX_ATTEMPTS) {
        prompts.user = originalUserPrompt + '\n\n' + gate.proceedNote;
        continue;
      }
    }

    try {
      parsed = parseLLMResponse(rawResponse);
    } catch (error) {
      // JsonSyntaxViolation — wrap in retry loop. Mirrors the
      // ExecutionTierViolation / DecisionTagViolation branches below
      // (`originalUserPrompt + framing` reset, `continue`, MAX_ATTEMPTS gate).
      // `parseTasksBody` escalates SyntaxError from individual <task> body
      // JSON.parse calls; LLM stochastic JSON drift can be absorbed in 1–2
      // retries instead of crashing the job.
      if (error instanceof JsonSyntaxViolation && attempt < MAX_ATTEMPTS) {
        console.warn(
          `⚠️  [Decompose] JSON syntax violation attempt ${attempt}/${MAX_ATTEMPTS}: ` +
            `${error.detail.message} — retrying with framing`,
        );
        prompts.user = originalUserPrompt + buildJsonSyntaxViolationFraming(error);
        continue;
      }
      // MissingTasksTagViolation — a response with no complete <tasks> block
      // (prose-only drift, degenerate output, or max_tokens truncation before
      // `</tasks>`). Same absorb-with-framing contract as the sibling
      // violations; previously this was an untyped Error and the ONLY
      // zero-tolerance contract failure (first bad response crashed the job).
      if (error instanceof MissingTasksTagViolation && attempt < MAX_ATTEMPTS) {
        console.warn(
          `⚠️  [Decompose] Missing <tasks> block attempt ${attempt}/${MAX_ATTEMPTS} ` +
            `(unclosedOpeningTag=${error.detail.hasUnclosedOpeningTag}) — retrying with framing`,
        );
        prompts.user = originalUserPrompt + buildMissingTasksTagViolationFraming(error);
        continue;
      }
      logErrorHeader('Decompose');
      console.error(error);
      throw error;
    }

    // Phase 1 M-2 — DecisionTagRegistry violation retry. Validate the
    // matrix-required decision tags BEFORE the executionTier validation
    // so a single retry can address both contract failures together. The
    // retry framing concatenates each violation source so the LLM sees
    // both demands in one re-prompt. Result is stashed in
    // `decisionTagsAtFinal` for reuse by STEP 6.65 (single parse / turn).
    let decisionTagViolationFraming = '';
    if (state.resolvedAction && _effectiveDomain) {
      const { parseDecisionTags, decisionTagRetryFraming } =
        await import('../../../../../../core/llm-response/DecisionTagRegistry');
      decisionTagsAtFinal = parseDecisionTags(rawResponse);
      const expectedTags: Array<'gameArtTier'> = [];
      if (isTierActive('gameArtTier', _decomposeSlot, _effectiveDomain, _runtime)) {
        expectedTags.push('gameArtTier');
      }
      const missingExpected = expectedTags.filter(t => decisionTagsAtFinal!.parsed[t] === undefined);
      if (missingExpected.length > 0 || decisionTagsAtFinal.violations.length > 0) {
        decisionTagViolationFraming = decisionTagRetryFraming(
          missingExpected,
          decisionTagsAtFinal.violations,
        );
      }
    }

    try {
      executionTier = validateExecutionTier(parsed.executionTier, {
        mode: state.resolvedAction?.mode,
        nodeLabel: 'Decompose',
        pool,
        hasErrorInDirective,
      });
      // Tier 3 cross-task analysis brief — required by the deep-think
      // contract. Tier 4 has the external ref doc as the cross-task SSOT
      // and Tier 0/1/2 do not need a cross-task channel; only Tier 3
      // emits. Missing at Tier 3 retries with framing; spurious emission
      // at Tier 4 is dropped with a warning.
      let analysisRequiredFraming = '';
      if (executionTier === 3 && !parsed.analysis) {
        analysisRequiredFraming =
          '\n\n[ANALYSIS REQUIRED] Your previous response classified ' +
          '`<executionTier>3</executionTier>` but did NOT emit ' +
          '`<analysis>...</analysis>`. Tier 3 has no external reference document, ' +
          'so the per-task `plan` nodes need a job-level brief that captures the ' +
          'macro goal, decomposition rationale, cross-cutting concerns, and (for ' +
          'error cases) the diagnosis + solution direction. Re-emit the response ' +
          'with an `<analysis>...</analysis>` block placed BEFORE `<tasks>` ' +
          '(free-form markdown, ~0.5–3 KB). Forbidden at Tier 4; required at Tier 3.\n';
      }
      if (executionTier === 4 && parsed.analysis) {
        console.warn(
          '⚠️  [Decompose] <analysis> emitted at Tier 4 — dropping. The ' +
            'reference document is the cross-task SSOT at Tier 4; <analysis> ' +
            'is duplicate.',
        );
        parsed.analysis = undefined;
      }

      // Even if executionTier passed, retry when decision tags are missing
      // for matrix-active tiers (game projects need gameArtTier emission for
      // the LLM SSOT to be honoured) OR when Tier 3 analysis is missing.
      if ((decisionTagViolationFraming || analysisRequiredFraming) && attempt < MAX_ATTEMPTS) {
        console.warn(
          `⚠️  [Decompose] Contract violation attempt ${attempt}/${MAX_ATTEMPTS} — retrying with framing` +
            (analysisRequiredFraming ? ' (analysis required)' : '') +
            (decisionTagViolationFraming ? ' (decision tags)' : '') +
            '.',
        );
        prompts.user = originalUserPrompt + decisionTagViolationFraming + analysisRequiredFraming;
        continue;
      }
      // Hard contract: every emitted task.type must be a canonical enum
      // value. Validate inside the retry loop (not after) so the LLM gets
      // a corrective framing on stochastic mis-categorisation (e.g.
      // emitting the mode name "refactor" as a task type).
      validateTaskTypeEnum(parsed.tasks);
      // Authored-scope floor: every task must carry a non-empty description
      // (Task Description Authorship SSOT). Inside the loop so an omission
      // retries with framing instead of flowing through createTaskQueue's
      // `as CodeTask` cast into execute as an undefined work statement.
      validateTaskDescriptions(parsed.tasks);
      // Tier-shape contract (Tier 2 exactly-one + selfVerifyOnDone; Tier 3/4
      // >= 2 tasks + Final Verification + no selfVerifyOnDone leak). Runs
      // AFTER the type-enum check (isVerificationTask needs valid types) and
      // inside the loop so shape drift retries with framing instead of
      // crashing at createTaskQueue's post-loop backstop (fixed-imaging-batch
      // incident: glm Tier 4 selfVerifyOnDone leak → process_crash).
      validateTierTaskShape(parsed.tasks, executionTier);
      break; // contract satisfied
    } catch (e) {
      if (e instanceof InvalidTaskTypeViolation) {
        if (attempt >= MAX_ATTEMPTS) {
          logErrorHeader('Decompose');
          console.error(
            `❌ [Decompose] Invalid task type exhausted ${MAX_ATTEMPTS} attempts: ${e.message}`,
          );
          throw e;
        }
        console.warn(
          `⚠️  [Decompose] Invalid task type attempt ${attempt}/${MAX_ATTEMPTS}: ` +
          `"${e.detail.observedType}" on "${e.detail.taskName}" — retrying with framing`,
        );
        prompts.user = originalUserPrompt + buildInvalidTaskTypeViolationFraming(e);
        continue;
      }

      if (e instanceof MissingTaskDescriptionViolation) {
        if (attempt >= MAX_ATTEMPTS) {
          logErrorHeader('Decompose');
          console.error(
            `❌ [Decompose] Missing task description exhausted ${MAX_ATTEMPTS} attempts: ${e.message}`,
          );
          throw e;
        }
        console.warn(
          `⚠️  [Decompose] Missing task description attempt ${attempt}/${MAX_ATTEMPTS}: ` +
          `task "${e.detail.taskName}" — retrying with framing`,
        );
        prompts.user = originalUserPrompt + buildMissingTaskDescriptionViolationFraming(e);
        continue;
      }

      if (e instanceof TierShapeViolation) {
        if (attempt >= MAX_ATTEMPTS) {
          logErrorHeader('Decompose');
          console.error(
            `❌ [Decompose] Tier shape violation exhausted ${MAX_ATTEMPTS} attempts: ${e.message}`,
          );
          throw e;
        }
        console.warn(
          `⚠️  [Decompose] Tier shape violation attempt ${attempt}/${MAX_ATTEMPTS}: ` +
          `${e.detail.kind} (tier=${e.detail.executionTier}, tasks=${e.detail.taskCount}` +
          `${e.detail.taskName ? `, task="${e.detail.taskName}"` : ''}) — retrying with framing`,
        );
        prompts.user = originalUserPrompt + buildTierShapeViolationFraming(e);
        continue;
      }

      if (!(e instanceof ExecutionTierViolation)) throw e;

      if (attempt >= MAX_ATTEMPTS) {
        logErrorHeader('Decompose');
        console.error(
          `❌ [Decompose] Tier contract violation exhausted ${MAX_ATTEMPTS} attempts: ${e.message}`,
        );
        throw e;
      }

      console.warn(
        `⚠️  [Decompose] Tier contract violation attempt ${attempt}/${MAX_ATTEMPTS}: ` +
        `${e.code} (mode=${e.mode ?? 'unknown'}, observed=${e.observedTier ?? 'none'}) — retrying with framing`,
      );
      // Pile both violation framings into the single retry so the LLM
      // sees executionTier + decision-tag demands together.
      prompts.user = originalUserPrompt
        + buildExecutionTierViolationFraming(e)
        + decisionTagViolationFraming;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4.5: Check if clarify was triggered during tool loop
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (clarifyPaused) {
    console.log('⏸️  [Decompose] <clarify> emitted — pausing for user response');

    if (state.deps?.session && state.context.featureFolder) {
      try {
        // CRITICAL: FileSessionAdapter.updateArtifacts replaces session.state
        // wholesale. Load the existing state first and merge the pause markers
        // so jobId / jobTiming / tokenUsage / estimatingTokenUsage / profile /
        // userLanguage / etc. survive the pause. `resolvedAction` is persisted
        // so the continuation job reconstructs the artifact pool (context-loss
        // invariant); `stateUpdates` carries clarifyRoundsUsed/clarifyPhase.
        const existing = await state.deps.session.load(
          state.context.project,
          state.context.featureFolder,
          'code',
        );
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'code',
          {
            state: {
              ...(existing?.state || {}),
              awaitingDecomposeClarify: true,
              ...clarifyPaused.stateUpdates,
              resolvedAction: state.resolvedAction,
              directive: state.directive,
              overrideDirective: state.overrideDirective,
              chatSource: state.chatSource,
            }
          }
        );
      } catch { /* non-critical */ }
    }

    return {
      ...state,
      awaitingDecomposeClarify: true,
      ...clarifyPaused.stateUpdates,
      _phaseTimings: { ...(state._phaseTimings || {}), decompose: Date.now() - phaseStart },
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 5: Consume parsed response (already parsed + validated above)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // The retry loop at STEP 4 has already produced a parsed response whose
  // <executionTier> tag satisfies the mode-specific contract (see
  // validateExecutionTier). A `<clarify>` emission exits via the STEP 4.5
  // early return above, so both `parsed` and `executionTier` are defined here.
  if (!parsed || executionTier === undefined) {
    // Defensive — should be unreachable because the retry loop only
    // breaks on a validated tier OR on a clarify pause (handled above).
    throw new Error('[Decompose] Internal invariant violated: parsed/executionTier missing after retry loop');
  }

  // Publish the resolved tier to the broadcaster so it lands in the snapshot —
  // the billing meter/settle indexes the platform-fee base matrix by tier.
  state.deps?.kanbanUpdate?.updateExecutionTier?.(executionTier);
  const {
    tasks,
    referenceRequests,
    techTier: parsedTechTier,
    boundary: parsedBoundary,
    directHints,
    specClarify: rawSpecClarify,
  } = parsed;

  // References are for OTHER projects only. Drop any self-registration the LLM
  // emitted in the <references> tag so the current project never enters the
  // reference pool (the resolveReferenceCodebase guard is the runtime backstop).
  const currentProject = state.context?.project;
  const filteredReferenceRequests = referenceRequests?.filter(
    (r) => !currentProject || r.project !== currentProject,
  );

  // Defense-in-depth: when the upstream pipeline has already committed to
  // an intent (ActionsPanel explicit OR @-mention actionMetadata), the LLM
  // has no standing to emit `<specClarify>` — its three options all
  // re-adjudicate the intent (redirect_to_design = switch job,
  // proceed_without_spec = override source contract, cancel = abort).
  // Discard silently here; pair with the empty-tasks guard below to turn
  // a malformed emission into a loud re-decompose instead of a silent
  // 0-task success. See `agents/common/intentCommit.ts`.
  const specClarify = isIntentCommitted(state) ? undefined : rawSpecClarify;
  if (rawSpecClarify && !specClarify) {
    console.warn(
      `⚠️  [Decompose] LLM emitted <specClarify> for committed intent ` +
      `"${state.actionMetadata?.intent ?? state.resolvedAction?.intent}" — discarded (prompt violation).`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4.6: SpecClarify short-circuit
  // When LLM emitted <specClarify>, pause the job for user choice.
  // Triggering *criteria* are the LLM's responsibility (prompts); routing
  // logic (route_after_decompose_3way) consumes state.specClarify.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (specClarify && !state._specClarifyBypassed) {
    console.log('⏸️  [Decompose] specClarify emitted — pausing for user choice');

    if (state.deps?.session && state.context.featureFolder) {
      try {
        // CRITICAL: Preserve prior session.state when marking specClarify.
        // FileSessionAdapter.updateArtifacts replaces state wholesale, so a
        // partial patch would wipe jobId / jobTiming / tokenUsage /
        // estimatingTokenUsage / profile and break resume continuity after
        // proceed_without_spec.
        const existing = await state.deps.session.load(
          state.context.project,
          state.context.featureFolder,
          'code',
        );
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'code',
          {
            state: {
              ...(existing?.state || {}),
              awaitingDecomposeClarify: true,
              specClarify,
              executionTier,
              directHints,
              resolvedAction: state.resolvedAction,
              directive: state.directive,
              overrideDirective: state.overrideDirective,
              chatSource: state.chatSource,
            },
          }
        );
      } catch { /* non-critical */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
    }

    return {
      ...state,
      awaitingDecomposeClarify: true,
      specClarify,
      executionTier,
      directHints,
      _phaseTimings: { ...(state._phaseTimings || {}), decompose: Date.now() - phaseStart },
    };
  }

  const mode = state.resolvedAction?.mode;
  const isDirectPath = executionTier <= 1;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4.7: Silent-failure guard — empty task queue at Tier 2+ generate/refactor
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 2+ mandates a non-empty task breakdown for generate/refactor
  // modes UNLESS the LLM emits a valid <specClarify> (Tier 3/4 only —
  // Tier 2 is single-unit and cannot clarify). When a malformed
  // specClarify (e.g. body wrapped in a markdown code fence) is dropped
  // by the tag parser, the job silently completes with 0 files, masking
  // a critical prompt violation as success. Fail loudly instead — the
  // retry / re-decompose path is far less damaging than a no-op success.
  const isTaskTierLocal = executionTier >= 2;
  const isTaskBreakdownMode = mode === 'generate' || mode === 'refactor';
  if (isTaskTierLocal && isTaskBreakdownMode && tasks.length === 0 && !specClarify) {
    const intentCommitted = isIntentCommitted(state);
    const metadataIntent = state.actionMetadata?.intent;
    const resolvedIntent = state.resolvedAction?.intent;
    throw new Error(
      `❌ [Decompose] Empty <tasks> at executionTier=${executionTier} mode=${mode} ` +
      `(intent=${metadataIntent ?? resolvedIntent ?? 'unknown'}, ` +
      `source=${state.resolvedAction?.source ?? 'unknown'}, ` +
      `intentCommitted=${intentCommitted}).\n` +
      `\n` +
      (intentCommitted
        ? `Committed intent (ActionsPanel explicit OR @-mention actionMetadata) MUST emit a ` +
          `non-empty task breakdown at Tier 2+ generate/refactor. specClarify is gated off ` +
          `for committed intents — the LLM has no valid path to an empty queue here.\n`
        : `Tier 2+ generate/refactor MUST emit a non-empty task breakdown (Tier 2 = exactly 1 task ` +
          `with selfVerifyOnDone, Tier 3/4 = >= 2 tasks with verification task). Tier 3/4 may also ` +
          `emit a valid <specClarify> payload. Observed: tasks=[], specClarify=undefined — this is a ` +
          `critical prompt violation that would otherwise silently complete the job with 0 files.\n`
      ) +
      `\n` +
      `Common causes:\n` +
      `  • LLM wrapped a JSON tag body in a markdown code fence (\`\`\`json … \`\`\`). The parser now\n` +
      `    strips balanced fences, so a bare parse failure here means the payload is structurally invalid.\n` +
      `  • LLM emitted <specClarify> despite the committed-intent hard gate; it has already been discarded.\n` +
      `\n` +
      `Raw response head:\n${rawResponse.substring(0, 800)}`
    );
  }

  if (isDirectPath) {
    console.log(`🎯 [Decompose] Direct tier selected: executionTier=${executionTier}, mode=${mode || 'unknown'} (tasks=${tasks.length})`);
    // Matrix SSOT: Tier 0~1 → `<tasks>[]`. If the LLM emits tasks
    // anyway, the direct node bypasses the queue — passing them through
    // `validateTasks` / `createTaskQueue` would raise spurious "final
    // verification missing" errors and abort an otherwise-valid direct path.
    // Observe the violation (warn), then clear to keep the queue empty.
    if (tasks.length > 0) {
      console.warn(
        `⚠️  [Decompose] LLM emitted ${tasks.length} task(s) for executionTier=${executionTier} — ` +
        `expected '<tasks>[]' for Tier 0~1. Ignoring tasks; direct node will consume directHints only.`,
      );
      tasks.length = 0;
    }
  }

  // Inter-Job Context Bridge: finalize boundary
  const finalBoundary: Boundary = suggestedBoundary === SUGGESTED_BOUNDARY.PENDING
    ? ((parsedBoundary as Boundary) || BOUNDARY.LIGHTWEIGHT)
    : suggestedBoundary as Boundary;

  // Cross-intent PRD sync — the single-owner doc task. When the directive asked
  // to keep the related PRD in sync (the `<prdSync>` decision) AND this is a
  // multi-task tier, append ONE `doc` task carrying the write grant. It runs in
  // the doc band (after all feature/setup/test work via `preDocBarrier`, before
  // final verification), so it syncs against the settled implementation. Only
  // Tier 3/4 (multi-task) — Tier 2's exactly-one-task invariant forbids an extra
  // task, so directive-driven sync there is out of scope.
  if (parsed.prdSync && executionTier >= 3) {
    const targets = parsed.prdSync.targets;
    tasks.push({
      id: 'prd-sync',
      name: 'Sync planning docs',
      description:
        `Update the planning document(s) (${targets.join(', ')}) so they reflect the changes this job made, per the user's directive. ` +
        `Surgically update ONLY the sections the changes affect; preserve all unrelated content verbatim.`,
      type: 'doc',
      priority: 875, // doc band (850–899): after feature work, before final verification
      include: [...targets],
      prdSyncTargets: [...targets],
    } as CodeTask);
    console.log(`📝 [Decompose] Appended PRD-sync doc task → ${targets.join(', ')}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Validate and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  validateTasks(
    tasks,
    state.resolvedAction?.mode,
    state.directive,
    state.artifacts,
    state.workspaceState?.hasCodebase,
  );

  if (activeSpecRefFilename) {
    console.log(`📋 [Decompose] Active spec ref: ${activeSpecRefFilename}`);
  }
  const { taskQueue, featureTasks } = createTaskQueue(
    tasks,
    activeSpecRefFilename,
    uiSource ?? undefined,
    executionTier,
    computeRacScope(state.resolvedAction),
  );
  logTaskSummary(tasks, filteredReferenceRequests);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.5: Apply techTier from decompose response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (parsedTechTier) {
    const { buildTechTier, mergeTechTierConfigs } = await import('@ant/shared');
    const stack = parsedTechTier.stack as 'frontend' | 'backend' | 'fullstack' | undefined;
    const defaultTier = buildTechTier(
      { language: parsedTechTier.language, framework: parsedTechTier.framework ?? undefined },
      stack,
    );

    const inferredConfig: TechTierConfig = { stack };

    // Phase 1 — gameEngine 5th slot. The LLM emits `"gameEngine"` inside the
    // <techTier> JSON; the parser surfaces it as `parsedTechTier.gameEngine`
    // and we attach it to the frontend tier (Phaser/Godot/Cocos all run
    // in the browser, so engine is meaningful only on the frontend tier).
    const parsedGameEngine = parsedTechTier.gameEngine;

    if (stack === 'fullstack') {
      // Fullstack ⇒ FE and BE are distinct runtime categories, so frameworks
      // are ALWAYS two independent values read from the stack-keyed `frontend`
      // / `backend` sub-objects. NEVER fall back to `defaultTier.framework`
      // for framework — that would unify FE and BE under one framework, which
      // is incorrect. Language may legitimately be shared, so it keeps the
      // defaultTier fallback.
      const feParsed = parsedTechTier.frontend;
      const beParsed = parsedTechTier.backend;
      inferredConfig.frontend = {
        language: ((feParsed?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: feParsed?.framework ?? undefined,
        stack: 'frontend',
        gameEngine: parsedGameEngine,
      };
      inferredConfig.backend = {
        language: ((beParsed?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: beParsed?.framework ?? undefined,
        stack: 'backend',
      };
    } else {
      // Single-stack / no-stack — fullstack is fully handled above.
      if (stack === 'frontend') {
        inferredConfig.frontend = { ...defaultTier, stack: 'frontend', gameEngine: parsedGameEngine };
      }
      if (stack === 'backend') {
        inferredConfig.backend = { ...defaultTier, stack: 'backend' };
      }
      if (!stack) {
        // No stack ⇒ engine still goes on the default frontend tier.
        inferredConfig.frontend = { ...defaultTier, gameEngine: parsedGameEngine };
      }
    }

    const mergedConfig = mergeTechTierConfigs(state.resolvedAction?.basis?.techTier, inferredConfig);

    // Backfill packageManager from lockfile/package.json for existing codebases (modify mode)
    const _featureRoot = state.deps?.fileSystem?.getRootPath();
    if (_featureRoot) {
      try {
        const { detectPackageManager } = await import('../../../../../../core/utils/packageManager');
        const detectedPM = await detectPackageManager(_featureRoot);
        if (detectedPM) {
          for (const key of ['frontend', 'backend'] as const) {
            const tier = mergedConfig[key];
            if (tier && !tier.packageManager) {
              tier.packageManager = detectedPM;
            }
          }
          console.log(`📦 [Decompose] Detected package manager: ${detectedPM}`);
        }
      } catch { /* non-blocking */ }
    }

    state.resolvedAction = {
      ...state.resolvedAction!,
      basis: {
        ...state.resolvedAction?.basis,
        techTier: mergedConfig,
      },
    };
    const effectiveTier = mergedConfig.frontend ?? mergedConfig.backend;
    console.log(`✅ TechTier: stack=${stack}, language=${effectiveTier?.language}, framework=${effectiveTier?.framework || 'none'}, executionTier=${executionTier}`);
    if (parsedTechTier.stackReasoning) {
      console.log(`   Reasoning: ${parsedTechTier.stackReasoning}`);
    }
    if (stack === 'fullstack') {
      console.log(`   Fullstack frameworks: frontend=${mergedConfig.frontend?.framework || 'none'}, backend=${mergedConfig.backend?.framework || 'none'}`);
    }
    
    // Publish the techTier decision as a preview profile HINT. It is a greenfield
    // stand-in only: once the code job writes manifests, `ProjectProfileDetector`
    // observes the real thing and outranks this (`source: 'techtier-hint'`).
    //
    // Read from `effectiveTier`, not `parsedTechTier` — for `stack === 'fullstack'`
    // the frameworks live in the `frontend`/`backend` sub-objects, so the
    // top-level `parsedTechTier.framework` is always undefined there and the
    // framework never reached the UI.
    if (state.deps?.previewUpdate && state.context) {
      const stackToStructure: Record<string, 'frontend-only' | 'backend-only' | 'fullstack'> = {
        frontend: 'frontend-only',
        backend: 'backend-only',
        fullstack: 'fullstack',
      };
      const hint = {
        ...(effectiveTier?.language ? { language: effectiveTier.language } : {}),
        ...(effectiveTier?.framework ? { framework: effectiveTier.framework } : {}),
        ...(stack && stackToStructure[stack] ? { structureType: stackToStructure[stack] } : {}),
        source: 'techtier-hint' as const,
      };
      // Emit even without a resolved stack — a language alone is still worth
      // showing, and the manifest wins the moment code lands.
      if (hint.language || hint.framework || hint.structureType) {
        state.deps.previewUpdate.broadcastProjectProfileHint(
          state.context.project,
          state.context.featureFolder || 'main',
          hint,
          (state as any).userContext
        );
        console.log(`📡 [Decompose] Broadcast profile hint ${hint.language ?? 'none'}/${hint.framework ?? 'none'} (${hint.structureType ?? 'no structure'}) via SSE`);
      }
    }
    
    // (session RAC write moved below STEP 6.65 — writing here persisted a
    // pre-tier-apply RAC, so even the resume path restored a basis without
    // the visualTier/gameArtTier the decompose actually settled.)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.6: Apply visualTier from decompose response (gen-code-directive)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate: backend-only stacks have no visual policy, and when a UI design
  // document (ant / figma / handoff) is present in the RAC the doc IS the
  // design system authority — skip visualTier merge entirely and proactively
  // clear any pre-existing preset so downstream prompts don't reference it.
  if (
    state.resolvedAction?.intent === 'gen-code-directive' &&
    isTierActive(
      'visualTier',
      getConfigSlots(state.resolvedAction.intent)?.basis,
      getEffectiveDomain(state.resolvedAction?.domain),
      // `hasCodebase` activates the matrix's existing-codebase suppressor
      // (D27: stylesheets/tokens of an existing codebase ARE the visual
      // identity) on the BE — previously only the FE wizard passed it, so
      // this gate re-inferred a visual policy per job on existing projects.
      // Scoped to the visualTier gate: the techTier suppressor shares the
      // signal but decompose's techTier flags (`_runtime`) must stay live
      // for the `<techTier>` emit contract.
      {
        techTier: state.resolvedAction?.basis?.techTier,
        hasUiDoc: hasUi,
        hasCodebase: state.workspaceState?.hasCodebase === true,
      },
    )
  ) {
    const { resolveVisualTierFromDecompose } = await import('../../../../../common/visualTierResolver');
    const resolvedVT = resolveVisualTierFromDecompose(
      rawResponse,
      state.resolvedAction?.basis?.visualTier,
    );
    if (resolvedVT) {
      state.resolvedAction = {
        ...state.resolvedAction!,
        basis: {
          ...state.resolvedAction?.basis,
          visualTier: {
            ...state.resolvedAction?.basis?.visualTier,
            ...resolvedVT,
          },
        },
      };
      console.log(`✅ VisualTier: ${resolvedVT.visualLanguage ?? '-'}/${resolvedVT.surfaceSystem ?? '-'}/${resolvedVT.spatialSystem ?? '-'}`);
    }
  } else if (
    hasUi &&
    state.resolvedAction?.basis?.visualTier &&
    Object.keys(state.resolvedAction.basis.visualTier).length > 0
  ) {
    // UI doc wins: drop any pre-seeded visualTier preset so downstream
    // surfaces (plan / execute prompts, basis re-emit) don't inject a
    // conflicting visual policy alongside the design-system doc.
    state.resolvedAction = {
      ...state.resolvedAction,
      basis: {
        ...state.resolvedAction.basis,
        visualTier: undefined,
      },
    };
    console.log('🎨 VisualTier: suppressed (UI design doc present — doc is the design-system authority)');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.65: Apply Phase 1 decision tags (gameArtTier / serviceVirtualization)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // The decompose LLM emits `<gameArtTier>` only when that tier is
  // matrix-active. The 5th-slot `gameEngine` is parsed out of the existing
  // `<techTier>` JSON in STEP 6.5 (responseParser surfaces
  // `parsedTechTier.gameEngine`); it is NOT re-parsed here.
  //
  // We reuse the parse result the retry loop already produced (decisionTagsAtFinal)
  // to avoid the cost of a second pass through the response body.
  if (state.resolvedAction && _effectiveDomain && decisionTagsAtFinal) {
    const { applyDecisionTagDefaults } = await import('../../../../../../core/llm-response/DecisionTagRegistry');
    const expectedTags: Array<'gameArtTier' | 'domain' | 'serviceVirtualization'> = [];
    if (isTierActive('gameArtTier', _decomposeSlot, _effectiveDomain, _runtime)) {
      expectedTags.push('gameArtTier');
    }
    // §4 — SV build decision is expected for every service-domain code job, so
    // a missing tag default-fills to BUILD (optedOut:false) rather than leaving
    // basis.serviceVirtualization undefined.
    if (_effectiveDomain === 'service') {
      expectedTags.push('serviceVirtualization');
    }
    // serviceVirtualization keeps the parse-time default path (scalar-ish
    // shape, no carried-merge). gameArtTier defaults are applied AFTER the
    // carried/emitted/explicit merge below — filling at parse time would
    // let default axes clobber carried (workspace-seeded) axes through the
    // `{...carried, ...emitted, ...explicit}` spread.
    const applied = applyDecisionTagDefaults(
      decisionTagsAtFinal.parsed,
      expectedTags.filter((t) => t !== 'gameArtTier'),
    );

    const emittedGameArtTier = decisionTagsAtFinal.parsed.gameArtTier as import('@ant/shared').GameArtTier | undefined;
    const gameArtTierExpected = expectedTags.includes('gameArtTier');
    const serviceVirtualization = applied.serviceVirtualization as { optedOut: boolean } | undefined;

    if (gameArtTierExpected || serviceVirtualization) {
      const newBasis: import('@ant/shared').Basis = { ...state.resolvedAction.basis };
      if (gameArtTierExpected) {
        // Explicit gameArtTier axes (raw actionMetadata.basis.gameArtTier — the
        // user's wizard selection) are authoritative: the LLM emit only
        // supplies axes the explicit basis lacks, it never overrides a
        // user-pinned axis (e.g. perspective=3d). Mirrors the explicit-techTier
        // authority policy in STEP 6.7. Registry defaults fill LAST — only
        // axes missing from carried ∪ emitted ∪ explicit (per-key fill in
        // applyDecisionTagDefaults), so a partial emit can no longer leave
        // `concept: undefined` on the RAC.
        // Deterministic perspective observation (codebase manifests SSOT)
        // ranks above carried/emitted, below the explicit wizard choice.
        const observedPerspective = observePerspectiveFromCodebase(state.context?.featurePath);
        const merged = applyExplicitGameArtTierOverrides(
          state.resolvedAction.basis?.gameArtTier,
          emittedGameArtTier ?? {},
          {
            ...(observedPerspective ? { perspective: observedPerspective } : {}),
            ...state.actionMetadata?.basis?.gameArtTier,
          },
        );
        newBasis.gameArtTier = applyDecisionTagDefaults(
          { gameArtTier: merged },
          ['gameArtTier'],
        ).gameArtTier as import('@ant/shared').GameArtTier;
      }
      if (serviceVirtualization) newBasis.serviceVirtualization = serviceVirtualization;
      state.resolvedAction = { ...state.resolvedAction, basis: newBasis };
      console.log(
        `🎮 [Decompose] Phase-1 decision tags applied: ` +
        `gameArtTier=${newBasis.gameArtTier ? Object.keys(newBasis.gameArtTier).join(',') : '-'}, ` +
        `serviceVirtualization=${serviceVirtualization ? (serviceVirtualization.optedOut ? 'opt-out' : 'build') : '-'}`,
      );
    }
    if (decisionTagsAtFinal.violations.length > 0) {
      console.warn(
        `⚠️  [Decompose] decision tag violations:`,
        decisionTagsAtFinal.violations.map(v => `${v.tag}:${v.reason}`).join(', '),
      );
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.68: Persist the settled decisions (post-tier-apply)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // (a) Session RAC snapshot — moved here from STEP 6.5 so the persisted
  //     RAC reflects the applied visualTier/gameArtTier (the old pre-apply
  //     write restored a tier-less basis on resume).
  // (b) config.json basis — write-once settled tiers so subsequent jobs
  //     carry them via detect's seedBasisFromWorkspace instead of
  //     re-inferring per job (perspective 2d→3d flip, focal-molding-board).
  if (state.deps?.session && state.context.featureFolder) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder,
        'code'
      );
      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'code',
        {
          state: {
            ...session.state,
            resolvedAction: state.resolvedAction,
          }
        }
      );
    } catch (err) {
      // Non-critical
    }
  }
  if (state.resolvedAction?.basis) {
    const { persistSettledBasis } = await import('../../../../../../periphery/adapters/config/persistSettledBasis');
    persistSettledBasis(
      {
        gameArtTier: state.resolvedAction.basis.gameArtTier,
        visualTier: state.resolvedAction.basis.visualTier,
      },
      {
        explicit: {
          gameArtTier: state.actionMetadata?.basis?.gameArtTier,
          visualTier: state.actionMetadata?.basis?.visualTier,
        },
      },
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.7: Assign task-level techTier (task.stack → config slot)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const currentTechTierConfig = state.resolvedAction?.basis?.techTier;
  if (currentTechTierConfig) {
    // Explicit techTier (raw actionMetadata.basis.techTier — never merged with LLM emit)
    // is the authority signal: preset fields override LLM-emitted values for the same
    // stack. Mirrors the visualTier / gameArtTier policy.
    const explicitTechTier = state.actionMetadata?.basis?.techTier;
    for (const task of taskQueue.getAll()) {
      const resolved = resolveTaskTechTierFromStack(task.stack, currentTechTierConfig);
      task.techTiers = applyExplicitTechTierOverrides(resolved, explicitTechTier);
    }
    const narrowedCount = taskQueue.getAll().filter(t => {
      const first = t.techTiers?.[0];
      return first && first.stack !== currentTechTierConfig.stack;
    }).length;
    if (narrowedCount > 0) {
      console.log(`🎯 [Decompose] Task-level techTier: ${narrowedCount} task(s) narrowed from ${currentTechTierConfig.stack}`);
    }
    if (explicitTechTier) {
      const overrideCount = taskQueue.getAll().filter(t => {
        const first = t.techTiers?.[0];
        const e = first?.stack === 'frontend' ? explicitTechTier.frontend : first?.stack === 'backend' ? explicitTechTier.backend : undefined;
        return !!e?.framework;
      }).length;
      if (overrideCount > 0) {
        console.log(`🔒 [Decompose] Explicit techTier authoritative: applied to ${overrideCount} task(s)`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.75: Re-emit finalized basis to chat
  // LLM-merged techTier / visualTier are the "final" basis for this turn.
  // Routed through the Canonical Tag Rendering SSOT (SpecialTagTransformer
  // via emitDetectOutcome) — no bespoke formatting lives here.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.resolvedAction) {
    const { emitDetectOutcome } = await import('../../../../../../core/streaming/emitDetectOutcome');
    void emitDetectOutcome(state.resolvedAction, {
      locale: state._uiLocale,
      phase: 'decompose-final',
      executionTier,
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.8: Exit decompose node for workflow tracking
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8: Handle jobId/jobTiming (for replan scenarios)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { JobTimingManager } = await import('../../../../../common/graph/timing/JobTimingManager');
  
  // Check if replan preserved jobId/jobTiming
  const replanJobId = (state as any)._replanJobId;
  const replanJobTiming = (state as any)._replanJobTiming;
  
  let timingJobId: string;
  let jobTiming: any;
  const finalPhaseTimings = { ...(state._phaseTimings || {}), decompose: Date.now() - phaseStart };
  
  if (replanJobId) {
    console.log(`🔄 [Decompose] Replan: Preserving job timing (Job ID: ${replanJobId})`);
    timingJobId = replanJobId;
    jobTiming = replanJobTiming;
  } else {
    // ✨ Get jobId from session (already initialized in resolve node)
    const sessionData = await state.deps?.session?.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    timingJobId = sessionData?.state?.jobId || state._httpJobId!;
    const existingJobTiming = sessionData?.state?.jobTiming || JobTimingManager.initializeNewJob(state._httpJobId!).jobTiming;
    
    // ✅ CRITICAL: Finalize estimating phase (detect + decompose)
    const estimatingStartTime = existingJobTiming.startedAt || new Date().toISOString();
    jobTiming = JobTimingManager.finalizeEstimatingPhase(existingJobTiming, estimatingStartTime, finalPhaseTimings);
    
    console.log(`⏱️  [Decompose] Using job ID from session: ${timingJobId}`);
    console.log(`⏰  [Decompose] Estimating phase finalized: ${Math.round((jobTiming.estimatingDuration || 0) / 1000)}s`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8.5: Snapshot estimating phase token usage
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Capture job-level tokenUsage BEFORE tasks begin. At this point, state.tokenUsage
  // contains only estimating phase tokens (detect + decompose).
  const estimatingTokenUsage = state.tokenUsage
    ? { ...state.tokenUsage }
    : undefined;
  if (estimatingTokenUsage) {
    console.log(`📊 [Decompose] Estimating phase tokens captured: ${estimatingTokenUsage.inputTokens + estimatingTokenUsage.outputTokens} (input: ${estimatingTokenUsage.inputTokens}, output: ${estimatingTokenUsage.outputTokens}, cacheRead: ${estimatingTokenUsage.cacheReadTokens || 0}, cacheCreate: ${estimatingTokenUsage.cacheCreationTokens || 0})`);
    if (state.deps?.kanbanUpdate?.setEstimatingTokenUsage) {
      state.deps.kanbanUpdate.setEstimatingTokenUsage(estimatingTokenUsage);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 9: Save checkpoint with actual tasks
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const updatedState = {
    ...state,  // ✅ Includes tokenUsage accumulated from decompose LLM call
    taskQueue,
    featureTasks,
    referenceRequests: filteredReferenceRequests || state.referenceRequests || [],
    totalSubtasks: tasks.length + 1,
    subtaskIndex: 0,
    completedTasks: state.completedTasks || [],
    completedTasksDetails: state.completedTasksDetails || [],
    jobId: timingJobId,
    jobTiming,
    _estimatingTokenUsage: estimatingTokenUsage,
    _phaseTimings: finalPhaseTimings,
    boundary: finalBoundary,
    executionTier,
    analysis: parsed.analysis,
    directHints,
    specClarify: undefined,
    awaitingDecomposeClarify: false,
  };
  
  // ✅ Update broadcaster with finalized jobTiming (includes estimatingDuration + phaseBreakdown)
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(jobTiming);
  }

  // 📝 Debug-only — persist Tier 3 analysis brief for post-hoc verification.
  // Captures the final state.analysis after all inline retries; one file per
  // job at sessions/architect/debug/analysis/analysis-{jobId}.json.
  if (executionTier === 3) {
    await saveAnalysisForDebug(state, executionTier, parsed.analysis, attempt);
  }

  // ✅ Save checkpoint with tasks
  if (state.deps?.session) {
    const { saveCheckpoint } = await import('../../session/checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`✅ [Decompose] Checkpoint saved with ${tasks.length} tasks\n`);
  }

  // STEP 9.5 — user_turn_meta patch (§18 tier_ui_badge + featureContext
  // hint). Decompose is code's Tier Entry Node; the executionTier it
  // emits is the final classification for this turn. See
  // core/executionTier/recordUserTurnMeta.ts for idempotency / failure
  // semantics.
  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: timingJobId,
    jobType: 'code',
    executionTier,
    nodeLabel: 'Decompose',
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 10: Return updated state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return updatedState;
}

