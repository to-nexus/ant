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
import { ArchitectGraphState, TaskQueue } from "../../state";
import { CodeTask } from "../../../../types/task";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { logErrorHeader } from "../shared/errorHandler";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { ArtifactService } from "../../../../../../infrastructure/workspace/ArtifactService";
import { getEstimatingLabel } from "../../../../../common/graph/timing/estimatingLabels";

// Import submodules
import { validateTasks } from "./validation";
import { checkSessionRestore, restoreFromSession } from "./sessionManager";
import { prepareDesignDocument } from "./designSelector";
import { callLLMForDecompose } from "./llmCaller";
import { parseLLMResponse, createTaskQueue, logTaskSummary } from "./responseParser";
import { loadCodebaseFilePaths } from "./codebaseLoader";

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
  // 🔥 EXPLAIN MODE: Skip decompose, create single explain task
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.detectionReport?.jobMode === 'explain') {
    console.log('💡 [Decompose] Explain mode detected - creating single explanation task\n');
    
    const explainTask: CodeTask = {
      id: 'explain-1',
      name: 'Explain code',
      type: 'explain',
      priority: 200,
      description: state.directive || 'Explain the codebase'
    };
    
    const taskQueue = new TaskQueue<CodeTask>();
    taskQueue.push(explainTask);
    
    // ✅ Workflow exitNode (explain 조기 반환에서도 호출 필요)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
    }
    
    return {
      ...state,
      taskQueue,
      featureTasks: new Map(),
      referenceRequests: [],
      projectCodeContext: undefined,
      referenceCodeContexts: [],
      totalSubtasks: 1,
      subtaskIndex: 0,
      completedTasks: [],
      completedTasksDetails: [],
      boundary: 'lightweight' as const,
    };
  }
  
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
        completedTasks: sessionCheck.session.state.completedTasks || [],
        completedTasksDetails: sessionCheck.session.state.completedTasksDetails || [],
        referenceRequests: sessionCheck.session.state.referenceRequests || [],
        retries: 0,
        previousAttempts: [],
        enforcementHistory: [],
        lastViolations: [],
        resolvedCategories: []
      } as any;
      
      (state as any)._replanJobId = sessionCheck.session.jobId;
      (state as any)._replanJobTiming = sessionCheck.session.jobTiming;
      
      // Fall through to decomposition
    } else {
      // Normal resume
      return restoreFromSession(state, sessionCheck.session);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Keyword-based RAG (if requireRagForDecompose)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 
  // PURPOSE: Provide file list to LLM for accurate task planning
  // - LLM uses this list to know what files exist
  // - Prevents "Create missing X" when X actually exists
  // - Keywords from detectEnvironment determine search scope
  //
  let codebaseFilePaths: string[] | undefined = undefined;
  let gitDiffResult: any = undefined;
  
  
  if (state.detectionReport?.requireRag && state.decomposeKeywords) {
    const result = await loadCodebaseFilePaths(state);
    codebaseFilePaths = result.filePaths.length > 0 ? result.filePaths : undefined;
    gitDiffResult = result.gitDiff;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Prepare design documents (environment-aware)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { documents, hasDocuments, useToolMode } = prepareDesignDocument(state);

  // Inter-Job Context Bridge: pre-determine boundary classification
  const suggestedBoundary: 'heavyweight' | 'lightweight' | 'pending' =
    state.detectionReport?.jobMode === 'explain' ? 'lightweight'
    : hasDocuments ? 'heavyweight'
    : (state.specDocs && Object.keys(state.specDocs).length > 0) ? 'pending'
    : 'lightweight';
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!state.deps?.promptEngine) {
    throw new Error('[Decompose] PromptEngine not available');
  }
  
  // ✅ CRITICAL: Check if project has existing code via git (fallback if Vector DB empty)
  // Vector DB might be empty even when code exists (user hasn't run 'ant index')
  let hasProjectCode = false;
  if (state.deps?.git) {
    try {
      const repoRoot = await state.deps.git.getRepoRoot();
      console.log(`   🔍 [Decompose] Checking project code at: ${repoRoot}`);
      
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const entries = await fs.readdir(repoRoot, { withFileTypes: true });
      
      // Check for common source directories (Node: src/lib/app, Go: cmd/internal/services, Python: src/app)
      const hasSourceDir = entries.some((e: any) => 
        e.isDirectory() && (
          e.name === 'src' || e.name === 'lib' || e.name === 'app' ||
          e.name === 'cmd' || e.name === 'internal' || e.name === 'services'
        )
      );
      
      // Check for project config files (Node: package.json, Go: go.mod/go.work, etc.)
      const hasConfigFile = entries.some((e: any) => 
        e.isFile() && (
          e.name === 'package.json' ||
          e.name === 'go.mod' || e.name === 'go.work' ||
          e.name === 'Cargo.toml' ||
          e.name === 'pyproject.toml' || e.name === 'requirements.txt' ||
          e.name === 'pom.xml' || e.name === 'build.gradle' || e.name === 'build.gradle.kts'
        )
      );
      
      hasProjectCode = hasSourceDir || hasConfigFile;
      console.log(`   ${hasProjectCode ? '✅' : '❌'} Project code exists: ${hasProjectCode} (hasSourceDir=${hasSourceDir}, hasConfigFile=${hasConfigFile})`);
      
      if (hasProjectCode && (!codebaseFilePaths || codebaseFilePaths.length === 0)) {
        console.log(`⚠️  [Decompose] Project has code but codebaseFilePaths is empty — using git.listFiles() fallback`);
        try {
          const allFiles = await state.deps.git.listFiles('', [
            'node_modules', '.git', 'vendor', '__pycache__', 'dist', 'build',
            '.next', '.nuxt', '.output', 'coverage', '.turbo',
            '*.sum', '*.lock',
          ]);
          if (allFiles.length > 0) {
            codebaseFilePaths = allFiles;
            console.log(`   ✅ Fallback: loaded ${allFiles.length} files via git.listFiles()`);
          }
        } catch (fallbackErr) {
          console.warn(`   ⚠️  git.listFiles() fallback failed:`, fallbackErr);
        }
      }
    } catch (error) {
      console.warn(`⚠️  [Decompose] Failed to check project code existence:`, error);
      // Don't fail the entire decompose, just assume no code
      hasProjectCode = false;
    }
  }
  
  // ✅ Generate UI sections summary for split injection (shows available sections without full content)
  const uiSectionsSummary = state.parsedUiDocs 
    ? ArtifactService.getUiSectionsSummary(state.parsedUiDocs) 
    : undefined;
  
  // ✅ Build design document availability metadata for profile detection
  let designDocsMeta = '';
  if (state.designDocs) {
    const docs = state.designDocs;
    const lines: string[] = [];

    // API Contracts
    const apiKeys = Object.keys(docs.apiContracts);
    if (apiKeys.length > 0) {
      for (const name of apiKeys) {
        lines.push(`- api-contract-${name}: present`);
      }
    } else {
      lines.push(`- api-contract: absent`);
    }

    // Frontend
    const feKeys = Object.keys(docs.feDesigns);
    if (feKeys.length > 0) {
      for (const name of feKeys) {
        lines.push(`- fe-system-${name}: present`);
      }
    } else {
      lines.push(`- fe-system: absent`);
    }

    // Backend
    const beKeys = Object.keys(docs.beDesigns);
    if (beKeys.length > 0) {
      for (const name of beKeys) {
        lines.push(`- be-system-${name}: present`);
      }
    } else {
      lines.push(`- be-system: absent`);
    }

    designDocsMeta = lines.join('\n');
  }
  
  // ✅ Build spec docs metadata for LLM selection
  let specDocsMeta = '';
  if (state.specDocs && Object.keys(state.specDocs).length > 0) {
    const specLines = Object.entries(state.specDocs).map(([filename, content]) => {
      const firstLine = content.split('\n').find(l => l.startsWith('# '))?.replace('# ', '') || filename;
      return `- ${filename}: "${firstLine}" (${content.length} chars)`;
    });
    specDocsMeta = specLines.join('\n');
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
    specDoc,
    specApiContract,
    mode: state.detectionReport?.jobMode || 'unknown',
    profile: state.profile,
    designDocsMeta,
    specDocsMeta,
    codebaseFilePaths,
    hasProjectCode,
    uiSectionsSummary,
    runtimeAssetsIndex: state.runtimeAssetsIndex,
    hasErrorInDirective,
    // Inter-Job Context Bridge
    jobConversation: state.jobConversation,
    hasJobHistory: state.jobConversation && state.jobConversation.length > 0,
    needsBoundaryClassification: suggestedBoundary === 'pending',
  };
  
  const prompts = await state.deps.promptEngine.buildDecomposePrompt(decomposeVars);
  
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
          templatePath: 'code/phases/decompose/base (user) + code/phases/decompose/rules (system)',
          usedTemplates: [
            'code/phases/decompose/rules',
            'code/phases/decompose/profile-rules',
            'code/phases/decompose/mode-guide',
            'code/phases/decompose/error-or-general',
            'code/phases/decompose/existing-code-check',
            'code/phases/decompose/design-doc-guide',
          ],
          injectedVariables: {
            directive: decomposeVars.directive ? `[${decomposeVars.directive.length} chars]` : undefined,
            documents: documents.length > 0 ? `[${documents.length} docs]` : undefined,
            designDocsMeta: designDocsMeta ? 'SET' : undefined,
            hasDocuments,
            mode: decomposeVars.mode,
            hasProjectCode,
            codebaseFilePaths: codebaseFilePaths?.length || 0,
            uiSectionsSummary: uiSectionsSummary ? `[${uiSectionsSummary.length} chars]` : undefined,
            runtimeAssetsCount: state.runtimeAssetsIndex?.count || 0,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Decompose] Failed to log prompt:`, logError);
    }
  }
  
  let rawResponse: string;
  let decomposeTokenUsage: any;
  try {
    const { READ_DESIGN_DOC_TOOL, handleReadDesignDoc } = await import('./designSelector');
    const { DISCOVERY_TOOLS, createDiscoveryToolHandler, createClarifyContext } = await import('./discoveryTools');

    const clarifyCtx = createClarifyContext();
    const discoveryCtx = {
      featurePath: state.context.featurePath || '',
      codebasePath: (state as any).codebasePath || undefined,
      clarify: clarifyCtx,
    };
    const discoveryHandler = createDiscoveryToolHandler(discoveryCtx);

    const allTools = [...DISCOVERY_TOOLS, ...(useToolMode ? [READ_DESIGN_DOC_TOOL] : [])];
    const result = await callLLMForDecompose(llm, prompts, state.workspaceConfig, {
      tools: allTools,
      toolHandler: (name, args) => {
        if (name === 'read_design_doc') return handleReadDesignDoc(args.name, state);
        const discoveryResult = discoveryHandler(name, args);
        if (!discoveryResult.startsWith('Error: Unknown tool')) return discoveryResult;
        return `Error: Unknown tool "${name}"`;
      },
    });
    rawResponse = result.response;
    decomposeTokenUsage = result.tokenUsage;
    
    // ✅ Accumulate decompose token usage to job-level (not task-level, as decompose runs before tasks)
    if (decomposeTokenUsage) {
      const { finalizeStreamTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
      finalizeStreamTokenUsage(state as any, decomposeTokenUsage, { taskLevel: false, jobLevel: true });

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
          conversationHistoryLength: 0,
          projectCodeContextFiles: 0,
          estimatedPromptChars: (prompts.system.length + prompts.user.length) || 0,
          taskCumulativeInput: 0,
          taskCumulativeOutput: 0,
        }
      );

      // ✅ Push live token update to Kanban UI during estimating phase
      if (state.deps?.kanbanUpdate?.updateTokenUsage && (state as any).tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage((state as any).tokenUsage);
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
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'code',
          {
            state: {
              awaitingDecomposeClarify: true,
              detectionReport: state.detectionReport,
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
  
  const { tasks, referenceRequests, profile: parsedProfile, selectedSpec, unknownPackages, boundary: parsedBoundary } = parsed;

  // Inter-Job Context Bridge: finalize boundary
  const finalBoundary: 'heavyweight' | 'lightweight' = suggestedBoundary === 'pending'
    ? (parsedBoundary || 'lightweight')
    : suggestedBoundary;
  
  // Store LLM-selected spec in state (used by plan/execute for spec injection)
  if (selectedSpec && state.specDocs?.[selectedSpec]) {
    state.selectedSpec = selectedSpec;
    specDoc = state.specDocs[selectedSpec];
    const allContracts = Object.values(state.designDocs?.apiContracts || {});
    if (allContracts.length > 0) {
      specApiContract = allContracts.join('\n\n---\n\n');
    }
    console.log(`📋 [Decompose] LLM selected spec: ${selectedSpec} (${specDoc.length} chars)`);
  } else if (selectedSpec) {
    console.warn(`⚠️  [Decompose] selectedSpec "${selectedSpec}" not found in specDocs, ignoring`);
    state.selectedSpec = null;
  } else {
    state.selectedSpec = null;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: Validate and create task queue
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  validateTasks(tasks, state.detectionReport?.jobMode, state.directive, state.designDocs);
  
  const { taskQueue, featureTasks } = createTaskQueue(tasks);
  logTaskSummary(tasks, referenceRequests);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.5: Apply profile from decompose response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (parsedProfile) {
    // Update state.profile
    state.profile = {
      language: parsedProfile.language,
      framework: parsedProfile.framework || undefined,
    };
    
    // Update detectionReport with environment + profile (decompose is the authoritative source)
    if (state.detectionReport) {
      state.detectionReport = {
        ...state.detectionReport,
        environment: parsedProfile.environment as any,
        environmentReasoning: parsedProfile.environmentReasoning,
        profile: {
          language: parsedProfile.language,
          framework: parsedProfile.framework || undefined,
        },
      };
    }
    
    console.log(`✅ Profile: ${parsedProfile.language}${parsedProfile.framework ? ` + ${parsedProfile.framework}` : ''}`);
    console.log(`✅ Environment: ${parsedProfile.environment}`);
    console.log(`   Reasoning: ${parsedProfile.environmentReasoning}`);
    
    // ✅ Display profile in Chat UI (environment + language/framework only; jobMode already shown by detectEnv)
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
    const { formatProfileForChat } = await import('../../../../../../core/types/detection');
    const chatAPI = getChatAPIClient();
    
    if (state.detectionReport) {
      const formattedProfile = formatProfileForChat(state.detectionReport, 'ko');
      if (formattedProfile) {
        await chatAPI.sendLLMEvent({
          type: 'text',
          text: formattedProfile
        });
        await chatAPI.finalizeMessage();
      }
    }
    
    // ✅ Broadcast structureType + projectProfile to frontend via SSE (for Preview Config)
    if (state.deps?.previewUpdate && state.context) {
      const envToStructure: Record<string, 'frontend-only' | 'backend-only' | 'fullstack'> = {
        frontend: 'frontend-only',
        backend: 'backend-only',
        fullstack: 'fullstack',
      };
      const structureType = envToStructure[parsedProfile.environment];
      if (structureType) {
        const projectProfile = {
          language: parsedProfile.language,
          framework: parsedProfile.framework || undefined,
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
    
    // ✅ Save updated detectionReport to session
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
              detectionReport: state.detectionReport,
            }
          }
        );
      } catch (err) {
        // Non-critical
      }
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6.6: Exit decompose node for workflow tracking
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
    
    // ✅ CRITICAL: Finalize estimating phase (detectEnvironment + decompose)
    const estimatingStartTime = existingJobTiming.startedAt || new Date().toISOString();
    jobTiming = JobTimingManager.finalizeEstimatingPhase(existingJobTiming, estimatingStartTime, finalPhaseTimings);
    
    console.log(`⏱️  [Decompose] Using job ID from session: ${timingJobId}`);
    console.log(`⏰  [Decompose] Estimating phase finalized: ${Math.round((jobTiming.estimatingDuration || 0) / 1000)}s`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 8.5: Snapshot estimating phase token usage
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Capture job-level tokenUsage BEFORE tasks begin. At this point, state.tokenUsage
  // contains only estimating phase tokens (detectEnvironment + decompose).
  const estimatingTokenUsage = (state as any).tokenUsage
    ? { ...(state as any).tokenUsage }
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
  };
  
  // ✅ Update broadcaster with finalized jobTiming (includes estimatingDuration + phaseBreakdown)
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(jobTiming);
  }

  // ✅ Save checkpoint with tasks
  if (state.deps?.session) {
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`✅ [Decompose] Checkpoint saved with ${tasks.length} tasks\n`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 10: Return updated state
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return updatedState;
}
