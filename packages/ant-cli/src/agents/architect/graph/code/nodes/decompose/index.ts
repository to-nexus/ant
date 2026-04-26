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
import { ArchitectGraphState } from "../../state";
import { BOUNDARY, SUGGESTED_BOUNDARY, resolveTaskTechTiersFromMap, getTechTier, type Boundary, type TechTierConfig, SURFACE_SYSTEM_VARIANTS, SPATIAL_SYSTEM_VARIANTS, getVisualLanguagesWithModes, isTierActive, getEffectiveDomain, getConfigSlots, GAME_ART_CONCEPT_VARIANTS, GAME_ART_PERSPECTIVE_VARIANTS, GAME_GENRE_VARIANTS, GAME_CORE_LOOP_VARIANTS, SUPPORTED_GAME_ENGINES } from "@ant/shared";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { logErrorHeader } from "../_common/errorHandler";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
// ArtifactService no longer needed — metadata extracted from state.artifacts
import { getEstimatingLabel } from "../../../../../common/graph/timing/estimatingLabels";

// Import submodules
import { validateTasks } from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareDesignDocument } from "./designSelector";
import { callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, createTaskQueue, logTaskSummary } from "./responseParser";
import {
  ExecutionTierId,
  validateExecutionTier,
  ExecutionTierViolation,
  buildExecutionTierViolationFraming,
  recordUserTurnMeta,
} from "../../../../../../core/executionTier";
import { isIntentCommitted, buildIntentClarifyTemplateVars } from "../../../../../common/clarify";


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
  // STEP 3: Prepare design documents (environment-aware)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { documents, hasDocuments, useToolMode } = prepareDesignDocument(state);

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
      const allFiles = await fsPort.listFiles('codebase', [
        'node_modules', '.git', 'vendor', '__pycache__', 'dist', 'build',
        '.next', '.nuxt', '.output', 'coverage', '.turbo',
        '*.sum', '*.lock',
      ]);

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
  // `.cursorrules` "Post-RAC Template Condition SSOT"). Role-agnostic
  // "availability meta" blocks (uiSectionsSummary / designDocsMeta /
  // uiHint) were removed — the pool already injects those documents
  // via role-annotated sections in the prompt, so re-listing paths
  // was duplicate context.
  const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');

  // Generic role-based artifact injection:
  // System designs, specs, and UI have decompose-specific handling above.
  // Everything else is injected generically by role so new categories
  // never require code changes.
  const specialPrefixes = [AP.SYSTEM_DESIGN, AP.SPEC, AP.UI];
  const genericArtifacts = pool.all.filter(a =>
    a.content?.trim() && !specialPrefixes.some(p => a.path.startsWith(p))
  );
  const refArtifacts = genericArtifacts.filter(a => a.role === 'ref');
  const contextArtifacts = genericArtifacts.filter(a => a.role === 'context');
  const hasGenericArtifacts = refArtifacts.length > 0 || contextArtifacts.length > 0;
  if (hasGenericArtifacts) {
    const totalChars = genericArtifacts.reduce((s, a) => s + (a.content?.length || 0), 0);
    console.log(`📄 [Decompose] Generic artifacts: ${refArtifacts.length} ref(s) + ${contextArtifacts.length} context(s), ${totalChars.toLocaleString()} chars`);
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

  // Detect error indicators in directive for error-or-general template activation
  const hasErrorInDirective = (() => {
    const d = (state.directive || '').toLowerCase();
    return /\b(error|exception|crash|fail(ed|ure|s)?|stack\s*trace|cannot\s+read|is\s+not\s+(a\s+function|defined)|unexpected\s+token|module\s+not\s+found|typeerror|referenceerror|syntaxerror)\b/.test(d);
  })();

  const decomposeVars = {
    directive: state.directive || '',
    documents,
    hasDocuments,
    refArtifacts,
    contextArtifacts,
    hasGenericArtifacts,
    tierRefs,
    mode: state.resolvedAction?.mode || 'unknown',
    techTier: getTechTier(state),
    codebaseFilePaths,
    hasProjectCode,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    hasErrorInDirective,
    needsBoundaryClassification: suggestedBoundary === SUGGESTED_BOUNDARY.PENDING,
  };
  
  if (!state.deps.promptBuilder) throw new Error('[Decompose] PromptBuilder not available');

  const hasExistingCode = decomposeVars.hasProjectCode ?? 
    (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0);
  const fileList = (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0)
    ? decomposeVars.codebaseFilePaths.map((f: string) => `- ${f}`).join('\n') : '';
  const assetsHint = decomposeVars.runtimeAssetsIndex && decomposeVars.runtimeAssetsIndex.count > 0
    ? `\n\n## Runtime Assets Available (inputs/assets)\nThere are ${decomposeVars.runtimeAssetsIndex.count} runtime asset file(s) under inputs/assets.\nThese are NOT auto-copied. You MUST add a task to copy them into the correct static asset root for the target app (monorepo-aware).\nCopy rule: preserve relative paths under inputs/assets.\nPlacement rule by format:\n- SVG (.svg) → <app>/src/assets/ (source tree, for SVGR import)\n- Raster (png, jpg, webp) → <app>/public/ (static serving)\nExamples:\n- inputs/assets/icons/x.svg -> <app>/src/assets/icons/x.svg\n- inputs/assets/bg/hero.webp -> <app>/public/bg/hero.webp\nAsset file list (first 50):\n${decomposeVars.runtimeAssetsIndex.files.slice(0, 50).map((f: string) => `- ${f}`).join('\n')}\n`
    : '';
  // Gate flag — decompose activates design-system task guidance
  // whenever ANY UI artifact (ref or context) is present in the
  // post-RAC pool. The intent matrix assigns UI=ref for `gen-code-sys`
  // but UI=context for `gen-code-spec` / `rev-code` (see
  // `@ant/shared/action-config-matrix.ts`); both must trigger the same
  // decomposition rules (design-system ladder, uiSections schema),
  // otherwise the latter two intents regress into missing guidance.
  // See `.cursorrules` "Post-RAC Template Condition SSOT".
  const hasUi = pool.hasUi();

  // Functional meta — UI section IDs inform the LLM's `uiSections`
  // task assignment. Full content is NOT embedded here; plan/execute
  // load sections per task via artifactPolicy.
  //
  // ID = basename — fine for all three UiSource prefixes
  // (`outputs/design/ui/{ant,figma,handoff}/…`).
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
  const _gameContentTierEnabled = isTierActive('gameContentTier', _decomposeSlot, _effectiveDomain, _runtime);

  const enrichedVars = {
    ...decomposeVars,
    hasExistingCode, fileList, fileCount: decomposeVars.codebaseFilePaths?.length || 0,
    hasErrorInDirective: decomposeVars.hasErrorInDirective || false,
    hasUi,
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
    gameContentTierActive: _gameContentTierEnabled,
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
    gameArtPerspectiveCandidates: _gameArtTierEnabled
      ? GAME_ART_PERSPECTIVE_VARIANTS.map((v: string) => `\`${v}\``).join(', ')
      : undefined,
    gameGenreCandidates: _gameContentTierEnabled
      ? GAME_GENRE_VARIANTS.map((v: string) => `\`${v}\``).join(', ')
      : undefined,
    gameCoreLoopCandidates: _gameContentTierEnabled
      ? GAME_CORE_LOOP_VARIANTS.map((v: string) => `\`${v}\``).join(', ')
      : undefined,
    specClarifyBypassed: state._specClarifyBypassed === true,
    // Intent-level clarify gate. `<specClarify>` re-adjudicates the
    // active intent (redirect_to_design = job switch, proceed_without_spec
    // = skip source contract) and MUST NOT fire when the upstream
    // pipeline has already committed to an intent — whether via
    // ActionsPanel "Start via Chat" (source='explicit') or via @-mention
    // that populates `actionMetadata.intent`. See
    // `agents/common/intentCommit.ts` for the SSOT predicate.
    ...buildIntentClarifyTemplateVars(state),
  };
  const decomposeSystem = await state.deps.promptBuilder.render('jobs/code/nodes/decompose/variants/default/rules', enrichedVars);
  let envContract = '';
  try { envContract = await state.deps.promptBuilder.render('jobs/code/base/injections/preview-env-contract', {}); } catch { /* skip */ }
  const fullSystem = envContract ? `${decomposeSystem}\n\n---\n\n${envContract}` : decomposeSystem;
  const decomposeUser = await state.deps.promptBuilder.render('jobs/code/nodes/decompose/variants/default/base', enrichedVars);
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
          templatePath: 'jobs/code/nodes/decompose/variants/default/base (user) + jobs/code/nodes/decompose/variants/default/rules (system)',
          usedTemplates: [
            'jobs/code/nodes/decompose/variants/default/rules',
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
            hasUi,
            hasUiRef: pool.hasUiRef(),
            hasSystemDesignRef: pool.hasSystemDesignRef(),
            uiArtifactPaths: uiArtifactPaths.length,
            hasDocuments,
            mode: decomposeVars.mode,
            hasProjectCode,
            codebaseFilePaths: codebaseFilePaths?.length || 0,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
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
  
  const { createClarifyContext } = await import('./discoveryTools');
  const clarifyCtx = createClarifyContext();

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

  while (true) {
    attempt++;

    try {
      const { READ_DESIGN_DOC_TOOL, handleReadDesignDoc } = await import('./designSelector');
      const { DISCOVERY_TOOLS, createDiscoveryToolHandler } = await import('./discoveryTools');

      const discoveryCtx = {
        featurePath: state.context.featurePath || '',
        codebasePath: (state as any).codebasePath || undefined,
        clarify: clarifyCtx,
      };
      const discoveryHandler = createDiscoveryToolHandler(discoveryCtx);

      const allTools = [...DISCOVERY_TOOLS, ...(useToolMode ? [READ_DESIGN_DOC_TOOL] : [])];
      const result = await callLLMForDecompose(llm, prompts, state.workspaceConfig, {
        tools: allTools,
        toolHandler: async (name, args) => {
          if (name === 'read_design_doc') return handleReadDesignDoc(args.name, state);
          const discoveryResult = await discoveryHandler(name, args);
          if (!discoveryResult.startsWith('Error: Unknown tool')) return discoveryResult;
          return `Error: Unknown tool "${name}"`;
        },
        state,
      });
      rawResponse = result.response;
      decomposeTokenUsage = result.tokenUsage;

      if (decomposeTokenUsage) {
        const { applyEstimatingUsage } = await import('../../../../../common/graph/llmHelpers');
        applyEstimatingUsage(state, 'decompose', decomposeTokenUsage, {
          promptChars: prompts.system.length + prompts.user.length,
        });
      }
    } catch (error) {
      logErrorHeader('Decompose');
      console.error(error);
      throw error;
    }

    // If clarify was triggered at any attempt, pause — do NOT retry. A
    // clarify emission at a retry attempt still represents an
    // intent-level decision the user must make.
    if (clarifyCtx.clarifySent) break;

    try {
      parsed = parseLLMResponse(rawResponse);
    } catch (error) {
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
      const expectedTags: Array<'gameArtTier' | 'gameContentTier'> = [];
      if (isTierActive('gameArtTier', _decomposeSlot, _effectiveDomain, _runtime)) {
        expectedTags.push('gameArtTier');
      }
      if (isTierActive('gameContentTier', _decomposeSlot, _effectiveDomain, _runtime)) {
        expectedTags.push('gameContentTier');
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
      });
      // Even if executionTier passed, retry when decision tags are missing
      // for matrix-active tiers (game projects need gameArtTier/gameContentTier
      // emission for the LLM SSOT to be honoured).
      if (decisionTagViolationFraming && attempt < MAX_ATTEMPTS) {
        console.warn(
          `⚠️  [Decompose] Decision tag violation attempt ${attempt}/${MAX_ATTEMPTS} — retrying with framing.`,
        );
        prompts.user = originalUserPrompt + decisionTagViolationFraming;
        continue;
      }
      break; // contract satisfied
    } catch (e) {
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
  if (clarifyCtx.clarifySent) {
    console.log('⏸️  [Decompose] Clarify tool invoked — pausing for user response');

    if (state.deps?.session && state.context.featureFolder) {
      try {
        // CRITICAL: FileSessionAdapter.updateArtifacts replaces session.state
        // wholesale. Load the existing state first and merge the pause markers
        // so jobId / jobTiming / tokenUsage / estimatingTokenUsage / profile /
        // userLanguage / etc. survive the pause.
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
      _phaseTimings: { ...(state._phaseTimings || {}), decompose: Date.now() - phaseStart },
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 5: Consume parsed response (already parsed + validated above)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // The retry loop at STEP 4 has already produced a parsed response whose
  // <executionTier> tag satisfies the mode-specific contract (see
  // validateExecutionTier). clarifySent exits via the STEP 4.5 early
  // return above, so both `parsed` and `executionTier` are defined here.
  if (!parsed || executionTier === undefined) {
    // Defensive — should be unreachable because the retry loop only
    // breaks on a validated tier OR on clarifySent (handled above).
    throw new Error('[Decompose] Internal invariant violated: parsed/executionTier missing after retry loop');
  }
  const {
    tasks,
    referenceRequests,
    techTier: parsedTechTier,
    boundary: parsedBoundary,
    directHints,
    specClarify: rawSpecClarify,
  } = parsed;

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
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Validate and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  validateTasks(tasks, state.resolvedAction?.mode, state.directive, state.artifacts);

  if (activeSpecRefFilename) {
    console.log(`📋 [Decompose] Active spec ref: ${activeSpecRefFilename}`);
  }
  const { taskQueue, featureTasks } = createTaskQueue(
    tasks,
    activeSpecRefFilename,
    uiSource ?? undefined,
    executionTier,
  );
  logTaskSummary(tasks, referenceRequests);
  
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
    const pkgTiers = parsedTechTier.packageTiers as Record<string, { language?: string; framework?: string; stack: string }> | undefined;

    // Phase 1 — gameEngine 5th slot. The LLM emits `"gameEngine"` inside the
    // <techTier> JSON; the parser surfaces it as `parsedTechTier.gameEngine`
    // and we attach it to the frontend tier (Phaser/Godot/Cocos all run
    // in the browser, so engine is meaningful only on the frontend tier).
    const parsedGameEngine = parsedTechTier.gameEngine;

    if (pkgTiers && stack === 'fullstack') {
      const feEntries = Object.values(pkgTiers).filter(e => e.stack === 'frontend');
      const beEntries = Object.values(pkgTiers).filter(e => e.stack === 'backend');
      const feEntry = feEntries[0];
      const beEntry = beEntries[0];
      inferredConfig.frontend = {
        language: ((feEntry?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: feEntry?.framework ?? defaultTier.framework,
        stack: 'frontend',
        gameEngine: parsedGameEngine,
      };
      inferredConfig.backend = {
        language: ((beEntry?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: beEntry?.framework ?? defaultTier.framework,
        stack: 'backend',
      };
    } else {
      if (stack === 'fullstack' || stack === 'frontend') {
        inferredConfig.frontend = { ...defaultTier, stack: 'frontend', gameEngine: parsedGameEngine };
      }
      if (stack === 'fullstack' || stack === 'backend') {
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
    if (parsedTechTier.packageTiers) {
      console.log(`   PackageTiers: ${Object.keys(parsedTechTier.packageTiers).join(', ')}`);
    }
    
    if (state.deps?.previewUpdate && state.context) {
      const stackToStructure: Record<string, 'frontend-only' | 'backend-only' | 'fullstack'> = {
        frontend: 'frontend-only',
        backend: 'backend-only',
        fullstack: 'fullstack',
      };
      const structureType = stack ? stackToStructure[stack] : undefined;
      if (structureType) {
        const projectProfile = {
          language: parsedTechTier.language,
          framework: parsedTechTier.framework || undefined,
        };
        state.deps.previewUpdate.broadcastStructureType(
          state.context.project,
          state.context.featureFolder || 'main',
          structureType,
          (state as any).userContext,
          projectProfile
        );
        console.log(`📡 [Decompose] Broadcast structureType=${structureType} projectProfile=${projectProfile.language}/${projectProfile.framework || 'none'} via SSE`);
      }
    }
    
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
      { techTier: state.resolvedAction?.basis?.techTier, hasUiDoc: hasUi },
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
  // STEP 6.65: Apply Phase 1 decision tags (gameArtTier / gameContentTier)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // The decompose LLM emits `<gameArtTier>` and `<gameContentTier>` only when
  // those tiers are matrix-active. The 5th-slot `gameEngine` is parsed
  // out of the existing `<techTier>` JSON in STEP 6.5 (responseParser
  // surfaces `parsedTechTier.gameEngine`); it is NOT re-parsed here.
  //
  // We reuse the parse result the retry loop already produced (decisionTagsAtFinal)
  // to avoid the cost of a second pass through the response body.
  if (state.resolvedAction && _effectiveDomain && decisionTagsAtFinal) {
    const { applyDecisionTagDefaults } = await import('../../../../../../core/llm-response/DecisionTagRegistry');
    const expectedTags: Array<'gameArtTier' | 'gameContentTier' | 'domain'> = [];
    if (isTierActive('gameArtTier', _decomposeSlot, _effectiveDomain, _runtime)) {
      expectedTags.push('gameArtTier');
    }
    if (isTierActive('gameContentTier', _decomposeSlot, _effectiveDomain, _runtime)) {
      expectedTags.push('gameContentTier');
    }
    const applied = applyDecisionTagDefaults(decisionTagsAtFinal.parsed, expectedTags);

    const gameArtTier = applied.gameArtTier as import('@ant/shared').GameArtTier | undefined;
    const gameContentTier = applied.gameContentTier as import('@ant/shared').GameContentTier | undefined;

    if (gameArtTier || gameContentTier) {
      const newBasis: import('@ant/shared').Basis = { ...state.resolvedAction.basis };
      if (gameArtTier) newBasis.gameArtTier = { ...(state.resolvedAction.basis?.gameArtTier ?? {}), ...gameArtTier };
      if (gameContentTier) newBasis.gameContentTier = { ...(state.resolvedAction.basis?.gameContentTier ?? {}), ...gameContentTier };
      state.resolvedAction = { ...state.resolvedAction, basis: newBasis };
      console.log(
        `🎮 [Decompose] Phase-1 decision tags applied: ` +
        `gameArtTier=${gameArtTier ? Object.keys(gameArtTier).join(',') : '-'}, ` +
        `gameContentTier=${gameContentTier ? Object.keys(gameContentTier).join(',') : '-'}`,
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
  // STEP 6.7: Assign task-level techTier (packageTiers mapping)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const currentTechTierConfig = state.resolvedAction?.basis?.techTier;
  if (currentTechTierConfig) {
    for (const task of taskQueue.getAll()) {
      task.techTiers = resolveTaskTechTiersFromMap(task.packages, currentTechTierConfig, parsedTechTier?.packageTiers);
    }
    const narrowedCount = taskQueue.getAll().filter(t => {
      const first = t.techTiers?.[0];
      return first && first.stack !== currentTechTierConfig.stack;
    }).length;
    if (narrowedCount > 0) {
      console.log(`🎯 [Decompose] Task-level techTier: ${narrowedCount} task(s) narrowed from ${currentTechTierConfig.stack}`);
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
    referenceRequests: referenceRequests || state.referenceRequests || [],
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
    directHints,
    specClarify: undefined,
    awaitingDecomposeClarify: false,
  };
  
  // ✅ Update broadcaster with finalized jobTiming (includes estimatingDuration + phaseBreakdown)
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(jobTiming);
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

