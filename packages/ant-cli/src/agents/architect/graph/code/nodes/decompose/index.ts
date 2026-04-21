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
import { BOUNDARY, SUGGESTED_BOUNDARY, resolveTaskTechTiersFromMap, getTechTier, type Boundary, type TechTierConfig, VISUAL_LANGUAGE_VARIANTS, SURFACE_SYSTEM_VARIANTS, SPATIAL_SYSTEM_VARIANTS, getVisualLanguagesWithModes } from "@ant/shared";
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
import { ExecutionTierId } from "../../../../../../core/executionTier";


/**
 * Decompose Node - Main Entry Point
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('decompose', state._uiLocale), 'decompose');
  }
  
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
        lastViolations: [],
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
  let gitDiffResult: any;
  
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
  
  // ✅ Extract metadata from artifact pool via ArtifactPoolView
  const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');

  const uiArtifacts = pool.ui;
  const uiSectionsSummary = uiArtifacts.length > 0
    ? uiArtifacts.map(a => {
        const id = a.path.slice(AP.UI.length);
        return `- ${id} (${(a.content?.length || 0).toLocaleString()} chars)`;
      }).join('\n')
    : undefined;

  const systemArtifacts = pool.systemDesigns;
  let designDocsMeta = '';
  if (systemArtifacts.length > 0) {
    designDocsMeta = systemArtifacts.map(a => {
      const name = a.path.slice(AP.SYSTEM_DESIGN.length).replace(/\.md$/, '');
      return `- ${name}: present`;
    }).join('\n');
  }

  const specArtifacts = pool.specs;
  let specDocsMeta = '';
  if (specArtifacts.length > 0) {
    const specLines = specArtifacts.map(a => {
      const filename = a.path.slice(AP.SPEC.length);
      const firstLine = a.content?.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') || filename;
      return `- ${filename}: "${firstLine}" (${(a.content?.length || 0)} chars)`;
    });
    specDocsMeta = specLines.join('\n');
  }

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

  // Spec content is populated AFTER LLM selects via <selectedSpec> tag.
  // No auto-selection — the decompose LLM decides which spec is relevant.
  let specDoc = '';
  let specApiContract = '';

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
    specDoc,
    specApiContract,
    mode: state.resolvedAction?.mode || 'unknown',
    techTier: getTechTier(state),
    designDocsMeta,
    specDocsMeta,
    codebaseFilePaths,
    hasProjectCode,
    uiSectionsSummary,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    hasErrorInDirective,
    needsBoundaryClassification: suggestedBoundary === SUGGESTED_BOUNDARY.PENDING,
  };
  
  if (!state.deps.promptBuilder) throw new Error('[Decompose] PromptBuilder not available');

  const hasExistingCode = decomposeVars.hasProjectCode ?? 
    (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0);
  const fileList = (decomposeVars.codebaseFilePaths && decomposeVars.codebaseFilePaths.length > 0)
    ? decomposeVars.codebaseFilePaths.map((f: string) => `- ${f}`).join('\n') : '';
  const uiHint = decomposeVars.uiSectionsSummary ? `\n\n${decomposeVars.uiSectionsSummary}\n` : '';
  const assetsHint = decomposeVars.runtimeAssetsIndex && decomposeVars.runtimeAssetsIndex.count > 0
    ? `\n\n## Runtime Assets Available (inputs/assets)\nThere are ${decomposeVars.runtimeAssetsIndex.count} runtime asset file(s) under inputs/assets.\nThese are NOT auto-copied. You MUST add a task to copy them into the correct static asset root for the target app (monorepo-aware).\nCopy rule: preserve relative paths under inputs/assets.\nPlacement rule by format:\n- SVG (.svg) → <app>/src/assets/ (source tree, for SVGR import)\n- Raster (png, jpg, webp) → <app>/public/ (static serving)\nExamples:\n- inputs/assets/icons/x.svg -> <app>/src/assets/icons/x.svg\n- inputs/assets/bg/hero.webp -> <app>/public/bg/hero.webp\nAsset file list (first 50):\n${decomposeVars.runtimeAssetsIndex.files.slice(0, 50).map((f: string) => `- ${f}`).join('\n')}\n`
    : '';
  const enrichedVars = {
    ...decomposeVars,
    hasExistingCode, fileList, fileCount: decomposeVars.codebaseFilePaths?.length || 0,
    hasErrorInDirective: decomposeVars.hasErrorInDirective || false,
    hasUiDocs: Boolean(decomposeVars.uiSectionsSummary),
    hasSpecDocs: Boolean(decomposeVars.specDocsMeta),
    documents: decomposeVars.documents || [], hasDocuments: decomposeVars.hasDocuments || false,
    uiHint, assetsHint,
    resolvedAction: state.resolvedAction,
    availableVisualLanguages: VISUAL_LANGUAGE_VARIANTS.join(', '),
    availableVisualLanguagesWithModes: getVisualLanguagesWithModes(),
    availableSurfaceSystems: SURFACE_SYSTEM_VARIANTS.join(', '),
    availableSpatialSystems: SPATIAL_SYSTEM_VARIANTS.join(', '),
    specClarifyBypassed: state._specClarifyBypassed === true,
  };
  const decomposeSystem = await state.deps.promptBuilder.render('jobs/code/nodes/decompose/variants/default/rules', enrichedVars);
  let envContract = '';
  try { envContract = await state.deps.promptBuilder.render('jobs/code/base/injections/preview-env-contract', {}); } catch { /* skip */ }
  const fullSystem = envContract ? `${decomposeSystem}\n\n---\n\n${envContract}` : decomposeSystem;
  const decomposeUser = await state.deps.promptBuilder.render('jobs/code/nodes/decompose/variants/default/base', enrichedVars);
  const prompts = { system: fullSystem, user: decomposeUser };
  
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
          ],
          injectedVariables: {
            directive: decomposeVars.directive ? `[${decomposeVars.directive.length} chars]` : undefined,
            refArtifacts: refArtifacts.length > 0 ? `[${refArtifacts.length} file(s)]` : undefined,
            contextArtifacts: contextArtifacts.length > 0 ? `[${contextArtifacts.length} file(s)]` : undefined,
            documents: documents.length > 0 ? `[${documents.length} docs]` : undefined,
            designDocsMeta: designDocsMeta ? 'SET' : undefined,
            hasDocuments,
            mode: decomposeVars.mode,
            hasProjectCode,
            codebaseFilePaths: codebaseFilePaths?.length || 0,
            uiSectionsSummary: uiSectionsSummary ? `[${uiSectionsSummary.length} chars]` : undefined,
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

  let rawResponse: string;
  let decomposeTokenUsage: any;
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
    });
    rawResponse = result.response;
    decomposeTokenUsage = result.tokenUsage;
    
    // ✅ Accumulate decompose token usage to job-level (not task-level, as decompose runs before tasks)
    if (decomposeTokenUsage) {
      const { finalizeStreamTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
      finalizeStreamTokenUsage(state, decomposeTokenUsage, { taskLevel: false, jobLevel: true });

      // ✅ Log to debug/tokens/
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        decomposeTokenUsage,
        {
          taskId: 'decompose',
          taskName: 'Decompose',
          node: 'decompose',
          callIndex: 0,
          nodeHistoryLength: 0,
          projectCodeContextFiles: 0,
          estimatedPromptChars: (prompts.system.length + prompts.user.length) || 0,
          taskCumulativeInput: 0,
          taskCumulativeOutput: 0,
        }
      );

      // ✅ Push live token update to Kanban UI during estimating phase
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
    }
  } catch (error) {
    logErrorHeader('Decompose');
    console.error(error);
    throw error;
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
        // designDocUnknownPackages / userLanguage / etc. survive the pause.
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
  // STEP 5: Parse response and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let parsed;
  try {
    parsed = parseLLMResponse(rawResponse);
  } catch (error) {
    logErrorHeader('Decompose');
    console.error(error);
    throw error;
  }
  
  const {
    tasks,
    referenceRequests,
    techTier: parsedTechTier,
    selectedSpec,
    unknownPackages,
    boundary: parsedBoundary,
    executionTier: parsedExecutionTier,
    directHints,
    specClarify,
  } = parsed;

  // LLM's <executionTier> is the SSOT. If the tag is missing (prompt
  // violation), degrade to Tier 0 Reflex (safe read-only).
  const executionTier = parsedExecutionTier ?? ExecutionTierId.Reflex;

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
        // estimatingTokenUsage / profile / designDocUnknownPackages and
        // break resume continuity after proceed_without_spec.
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
  const isDirectPath = executionTier <= 2;

  if (isDirectPath) {
    console.log(`🎯 [Decompose] Direct tier selected: executionTier=${executionTier}, mode=${mode || 'unknown'} (tasks=${tasks.length})`);
    // Matrix SSOT: Tier 0~2 → `<tasks>[]`. If the LLM emits tasks
    // anyway, the direct node bypasses the queue — passing them through
    // `validateTasks` / `createTaskQueue` would raise spurious "final
    // verification missing" errors and abort an otherwise-valid direct path.
    // Observe the violation (warn), then clear to keep the queue empty.
    if (tasks.length > 0) {
      console.warn(
        `⚠️  [Decompose] LLM emitted ${tasks.length} task(s) for executionTier=${executionTier} — ` +
        `expected '<tasks>[]' for Tier 0~2. Ignoring tasks; direct node will consume directHints only.`,
      );
      tasks.length = 0;
    }
  }

  // Inter-Job Context Bridge: finalize boundary
  const finalBoundary: Boundary = suggestedBoundary === SUGGESTED_BOUNDARY.PENDING
    ? ((parsedBoundary as Boundary) || BOUNDARY.LIGHTWEIGHT)
    : suggestedBoundary as Boundary;
  
  // Store LLM-selected spec in state (used by plan/execute for spec injection)
  const selectedSpecArtifact = selectedSpec
    ? pool.findSpec(selectedSpec)
    : undefined;
  if (selectedSpec && selectedSpecArtifact?.content) {
    state.selectedSpec = selectedSpec;
    specDoc = selectedSpecArtifact.content;
    const contractArtifacts = pool.apiContracts;
    if (contractArtifacts.length > 0) {
      specApiContract = contractArtifacts.map(a => a.content).join('\n\n---\n\n');
    }
    console.log(`📋 [Decompose] LLM selected spec: ${selectedSpec} (${specDoc.length} chars)`);
  } else if (selectedSpec) {
    console.warn(`⚠️  [Decompose] selectedSpec "${selectedSpec}" not found in artifact pool, ignoring`);
    state.selectedSpec = null;
  } else {
    state.selectedSpec = null;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Validate and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  validateTasks(tasks, state.resolvedAction?.mode, state.directive, state.artifacts);
  
  const { taskQueue, featureTasks } = createTaskQueue(tasks, selectedSpec);
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

    if (pkgTiers && stack === 'fullstack') {
      const feEntries = Object.values(pkgTiers).filter(e => e.stack === 'frontend');
      const beEntries = Object.values(pkgTiers).filter(e => e.stack === 'backend');
      const feEntry = feEntries[0];
      const beEntry = beEntries[0];
      inferredConfig.frontend = {
        language: ((feEntry?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: feEntry?.framework ?? defaultTier.framework,
        stack: 'frontend',
      };
      inferredConfig.backend = {
        language: ((beEntry?.language ?? defaultTier.language) as 'typescript' | 'go') ?? 'typescript',
        framework: beEntry?.framework ?? defaultTier.framework,
        stack: 'backend',
      };
    } else {
      if (stack === 'fullstack' || stack === 'frontend') {
        inferredConfig.frontend = { ...defaultTier, stack: 'frontend' };
      }
      if (stack === 'fullstack' || stack === 'backend') {
        inferredConfig.backend = { ...defaultTier, stack: 'backend' };
      }
      if (!stack) {
        inferredConfig.frontend = defaultTier;
      }
    }

    const mergedConfig = mergeTechTierConfigs(state.resolvedAction?.basis?.techTier, inferredConfig);

    // Backfill packageManager from lockfile/package.json for existing codebases (modify mode)
    const _featureRoot = state.deps?.fileSystem?.getRootPath();
    if (_featureRoot) {
      try {
        const { detectPackageManager } = await import('../../../../../common/tool/handlers/runCommand');
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
    console.log(`✅ TechTier: stack=${stack}, language=${effectiveTier?.language}, framework=${effectiveTier?.framework || 'none'}`);
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
  if (state.resolvedAction?.intent === 'gen-code-directive') {
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
  // STEP 6.8: Exit decompose node for workflow tracking
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 7: Store codebase context (file paths + gitDiff)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const projectCodeContext = codebaseFilePaths && codebaseFilePaths.length > 0 ? {
    filePaths: codebaseFilePaths,
    files: [],
    gitDiff: gitDiffResult,
    stats: {
      filesLoaded: codebaseFilePaths.length,
      estimatedTokens: 0
    },
    source: 'decompose' as const
  } : undefined;
  
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
    designDocUnknownPackages: unknownPackages,
    projectCodeContext,
    referenceCodeContexts: [],
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 9.5: user_turn_meta patch (§18 tier_ui_badge + featureContext hint)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Decompose (code's Tier Entry Node) has produced the final executionTier
  // classification for this turn. Patch line feeds UI tier badge and the
  // resolve → featureContextBuilder prompt hint.
  //
  // Idempotency: if decompose re-runs (e.g. after `proceed_without_spec`),
  // a fresh meta line is appended. Reader merges by turnId and keeps the
  // latest.
  //
  // Side-effect only. Failures logged and swallowed.
  if (state.deps?.session && state.turnId && timingJobId) {
    try {
      await state.deps.session.appendUserTurnMeta({
        type: 'user_turn_meta',
        ts: new Date().toISOString(),
        jobId: timingJobId,
        turnId: state.turnId,
        jobType: 'code',
        executionTier,
      });
      console.log(`🧭 [Decompose] user_turn_meta appended (executionTier=${executionTier})`);
    } catch (err) {
      console.warn('⚠️  [Decompose] appendUserTurnMeta failed:', err);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 10: Return updated state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return updatedState;
}

