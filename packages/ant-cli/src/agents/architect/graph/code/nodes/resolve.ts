import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import { ReferenceContext } from "../../../../../core/codebase/types";
import * as path from "path";
import { getEstimatingLabel, detectUILocale } from "../../common/timing/estimatingLabels";

/**
 * Code Resolve Node
 * 
 * Phase 1: CodebaseRetriever 사용
 * - Vector DB 기반 관련 코드 검색
 * - Git diff 통합
 * - 토큰 효율적
 * 
 * Strategy:
 * 1. Git diff 있으면 → Git 기반
 * 2. Vector DB 있으면 → Vector 검색
 * 3. Fallback → Keyword 검색
 * 
 * Validation: Must have either design doc OR directive
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export async function resolve(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Detect UI locale from directive (first node to run)
  state._uiLocale = detectUILocale(state.overrideDirective || state.directive || '');
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', state._uiLocale), 'resolve');
  }
  
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node
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
      'resolve', 
      0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // Skip artifact loading if resuming (state already restored by runner)
  if (state.isResume) {
    console.log(`🔄 Resume: tasks=${state.taskQueue?.size() || 0}, detection=${!!state.detectionReport}, completed=${state.completedTasks?.length || 0}`);
    
    if (!state.workspaceConfig) {
      try {
        const { FileConfigAdapter } = await import('../../../../../periphery/adapters/config/FileConfigAdapter');
        const configAdapter = new FileConfigAdapter();
        state.workspaceConfig = await configAdapter.load(state.context.project);
      } catch (error) {
        console.error(`❌ Failed to reload workspaceConfig:`, error);
      }
    }

    // Resolve featurePath (needed for doc reload and asset indexing)
    if (!state.context.featurePath && state.deps?.workspaceResolver) {
      const userContext = {
        userId: state.context.userId || 'local',
        organizationId: state.context.organizationId || 'local',
        workspacePath: ''
      };
      state.context.featurePath = state.deps.workspaceResolver.getFeaturePath(
        userContext as any,
        state.context.project,
        state.context.featureFolder
      );
    }

    // Reload design artifacts from disk (not saved in checkpoint, user may have edited)
    const gitPort = state.deps?.git;
    const fileSystem = state.deps?.fileSystem;
    if (gitPort && fileSystem) {
      try {
        // Load raw design documents from disk (no filtering — detectEnvironment handles that)
        const env = state.detectionReport?.environment || 'unknown';
        state.designDocs = await ArtifactService.loadDesignDocuments(state.context, gitPort, fileSystem, env);

        // Load single design doc as fallback for state.design
        // detectEnvironment will overwrite this with the properly filtered/combined version
        const preferredEnv = env === 'frontend' ? 'frontend' as const
          : env === 'backend' ? 'backend' as const
          : undefined;
        const designResult = await ArtifactService.findLatestDesign(state.context, gitPort, fileSystem, preferredEnv);
        if (designResult?.content) {
          state.design = designResult.content;
          state.designDocPath = designResult.filePath;
        }

        const source = await ArtifactService.getSource(state.context, gitPort, fileSystem);
        if (source?.prd) state.prd = source.prd;

        state.parsedUiDocs = await ArtifactService.loadParsedUiContext(state.context, gitPort, fileSystem) || undefined;

        if (!state.profile && state.detectionReport?.profile) {
          state.profile = state.detectionReport.profile;
        }

        console.log(`📄 [Resolve/Resume] design=${!!state.design}, designDocs=${!!state.designDocs}, prd=${!!state.prd}, ui=${!!state.parsedUiDocs}`);
      } catch (error) {
        console.warn(`⚠️  [Resolve/Resume] Failed to reload design artifacts:`, error);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Index runtime assets (text-only) for LLM task planning
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    try {
      const featurePathAbs = state.context.featurePath;
      if (featurePathAbs) {
        const pathMod = await import('path');
        const fsMod = await import('fs');
        const assetsRootAbs = pathMod.join(featurePathAbs, 'inputs', 'assets');
        const files: string[] = [];
        const maxFiles = parseInt(process.env.ANT_RUNTIME_ASSETS_INDEX_MAX || '200', 10);

        const walk = (dirAbs: string) => {
          if (files.length >= maxFiles) return;
          let entries: any[] = [];
          try {
            entries = fsMod.readdirSync(dirAbs, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of entries) {
            if (files.length >= maxFiles) break;
            if (e.name.startsWith('.')) continue;
            const abs = pathMod.join(dirAbs, e.name);
            if (e.isDirectory()) walk(abs);
            else if (e.isFile()) {
              const relToFeature = pathMod.relative(featurePathAbs, abs).replace(/\\/g, '/');
              if (relToFeature && !relToFeature.startsWith('..')) files.push(relToFeature);
            }
          }
        };

        if (fsMod.existsSync(assetsRootAbs)) {
          walk(assetsRootAbs);
        }

        state.runtimeAssetsIndex = { files, count: files.length };
      } else {
        state.runtimeAssetsIndex = { files: [], count: 0 };
      }
    } catch {
      state.runtimeAssetsIndex = { files: [], count: 0 };
    }
    
    // ✅ Record phase timing
    state._phaseTimings = { ...(state._phaseTimings || {}), resolve: Date.now() - phaseStart };
    
    // ✅ Workflow instrumentation: Exit node (skip path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
    }
    
    return state;
  }
  
  // NEW JOB: Initialize jobId and jobTiming
  const { JobTimingManager } = await import('../../common/timing/JobTimingManager');
  const { jobId: newJobId, jobTiming: newJobTiming } = JobTimingManager.initializeNewJob(state._httpJobId!);
  
  // Clear conversation history for NEW JOB
  state.conversationHistory = [];
  
  // Save initial jobTiming + directive to session
  // ✅ CRITICAL: Save effective directive early so it survives process kill (before decompose)
  // Without this, if user cancels before decompose, resume has no directive
  // Priority: overrideDirective (from chat) > directive (from CLI/file)
  const effectiveDirective = state.overrideDirective || state.directive || undefined;
  if (state.deps?.session && state.context.featureFolder) {
    try {
      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'code',
        {
          state: {
            jobId: newJobId,
            jobTiming: newJobTiming,
            taskQueue: [],
            completedTasks: [],
            completedTasksDetails: [],
            overrideDirective: effectiveDirective,
            chatSource: state.chatSource
          }
        }
      );
    } catch (error) {
      // Failed to save initial jobTiming
    }
  }
  
  // ✅ Set jobTiming on broadcaster so every SSE broadcast includes timing
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(newJobTiming);
  }
  
  // Send "estimating started" signal (empty task list)
  if (state._httpJobId && state.deps?.kanbanUpdate) {
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,    // no currentTask yet
      [],      // no tasks yet
      [],      // no completed tasks yet
      0,       // recursionCount
      undefined // recursionLimit
    );
  }
  
  const { context } = state;
  const retriever = new CodebaseRetriever();
  
  // Get GitPort for file operations
  const gitPort = state.deps?.git;
  const fileSystem = state.deps?.fileSystem;
  if (!gitPort || !fileSystem) {
    throw new Error("GitPort and FileSystemPort not provided for file operations");
  }

  // 0. Validate workspace exists (WorkspaceResolver 기반)
  const workspaceResolver = state.deps?.workspaceResolver;
  if (!workspaceResolver) {
    throw new Error('WorkspaceResolver not provided in deps');
  }
  
  // ✅ Extract UserContext from ProjectContext
  const userContext = {
    userId: context.userId || 'local',
    organizationId: context.organizationId || 'local',
    workspacePath: ''
  };
  
  const workspacePath = workspaceResolver.getProjectPath(userContext, context.project);
  
  // ✅ Use Node.js fs directly for absolute paths (FileSystemPort expects relative paths)
  const fs = await import('fs');
  const workspaceExists = fs.existsSync(workspacePath);
  if (!workspaceExists) {
    throw new Error(
      `Workspace not found: ${workspacePath}\n\n` +
      `Please create workspace first:\n` +
      `  npm run init:workspace ${context.project}\n\n` +
      `Then prepare your inputs in:\n` +
      `  ${workspacePath}/${context.featureFolder}/inputs/`
    );
  }

  // Validate feature exists and store resolved path in context
  const featurePath = workspaceResolver.getFeaturePath(userContext, context.project, context.featureFolder);
  const featureExists = fs.existsSync(featurePath);
  if (!featureExists) {
    throw new Error(
      `Feature directory not found: ${featurePath}\n\n` +
      `Please create feature first:\n` +
      `  npm run init:feature ${context.project} ${context.featureFolder}\n\n` +
      `Then prepare your inputs in:\n` +
      `  ${featurePath}/inputs/`
    );
  }
  
  // ✅ Store resolved featurePath in context for use by other nodes
  context.featurePath = featurePath;

  // ✅ Index runtime assets (text-only) for LLM task planning (do NOT auto-copy)
  try {
    const path = await import('path');
    const fs = await import('fs');

    const assetsRootAbs = path.join(featurePath, 'inputs', 'assets');
    const files: string[] = [];
    const maxFiles = parseInt(process.env.ANT_RUNTIME_ASSETS_INDEX_MAX || '200', 10);

    const walk = (dirAbs: string) => {
      if (files.length >= maxFiles) return;
      let entries: any[] = [];
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length >= maxFiles) break;
        if (e.name.startsWith('.')) continue;
        const abs = path.join(dirAbs, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile()) {
          const relToFeature = path.relative(featurePath, abs).replace(/\\/g, '/');
          if (relToFeature && !relToFeature.startsWith('..')) files.push(relToFeature);
        }
      }
    };

    if (fs.existsSync(assetsRootAbs)) {
      walk(assetsRootAbs);
    }

    state.runtimeAssetsIndex = { files, count: files.length };
  } catch {
    state.runtimeAssetsIndex = { files: [], count: 0 };
  }

  // 1. Load design document (optional)
  const designResult = await ArtifactService.findLatestDesign(context, gitPort, fileSystem);
  const design = designResult?.content || undefined;
  const designDocPath = designResult?.filePath || undefined;
  
  // Load PRD (inputs/sources) for detectEnvironment & downstream prompts
  const source = await ArtifactService.getSource(context, gitPort, fileSystem);
  const prd = source?.prd || undefined;
  
  // Load parsed UI documents (Figma-derived) for split injection
  const parsedUiDocs = await ArtifactService.loadParsedUiContext(context, gitPort, fileSystem);
  
  console.log(`📄 [Resolve] Design: ${design ? 'loaded' : 'none'}, PRD: ${prd ? 'loaded' : 'none'}, UI: ${parsedUiDocs ? 'loaded' : 'none'}`);

  // ✅ Load all available design documents (api-contract / fe / be / system-design)
  // Use ArtifactService to ensure FileSystemPort receives workspace-relative paths
  const designDocs = await ArtifactService.loadDesignDocuments(context, gitPort, fileSystem, 'unknown');

  // ✅ Fallback: if structured designDocs are missing but a unified design exists, keep it usable
  if (
    (!designDocs.apiContract && !designDocs.feDesign && !designDocs.beDesign && !designDocs.unifiedDesign) &&
    design
  ) {
    designDocs.unifiedDesign = design;
  }

  // 2. Load directive with override priority
  // ✅ Priority: overrideDirective (from chat) > directive.md > directive-nnn.md
  let directive: string | undefined;
  
  if (state.overrideDirective) {
    // Chat input takes highest priority
    directive = state.overrideDirective;
  } else {
    // Load from file system
    directive = await ArtifactService.getDirective(context, 'code', gitPort, fileSystem) || undefined;
  }
  
  // Validate: Must have either design doc OR directive
  if (!design && !directive) {
        throw new Error(
          "No design document or directive found.\n" +
          "For new features: Run 'architect design' first.\n" +
          "For modifications: Provide directive in workspace/{project}/{feature}/inputs/directives/code/directive.md"
        );
  }

  // 3. Build session context for LLM (mode inference moved to detectEnvironment)
  const { SessionContextBuilder } = await import('../../../../../agents/architect/session/SessionContextBuilder');
  const sessionBuilder = new SessionContextBuilder();
  
  // Get session history
  const session = state.deps?.session 
    ? await state.deps.session.load(context.project, context.featureFolder, 'code')
    : null;
  
  // Build compressed session context for LLM
  const sessionContextForLLM = session?.turns && session.turns.length > 0
    ? sessionBuilder.buildContextForLLM(
        session.turns,
        'generate', // Placeholder, actual mode determined in detectEnvironment
        directive || design || ''
      )
    : undefined;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. Profile Analysis (MINIMAL - only for language/framework detection)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 
  // PURPOSE: Detect language/framework for prompt selection
  // CONDITION: Only if analyzer is available AND codebase exists
  // SCOPE: Very minimal - just need package.json, tsconfig.json, main entry files
  //
  // ⚠️ This is NOT for task planning (that's detectEnvironment + decompose)
  // ⚠️ This is NOT for code generation (that's plan + codeGen)
  //
  let profile = undefined;
  const analyzer = state.deps?.analyzer;
  const referenceContexts: ReferenceContext[] = [];
  
  // Profile detection moved to detectEnvironment node (LLM-based)

  // ✅ Return minimal state (profile only, NO mode - mode determined in detectEnvironment)
  const result = {
    ...state,
    directive,
    prd,
    parsedUiDocs: parsedUiDocs || undefined,  // ✅ Parsed UI docs for split injection (null → undefined)
    design,
    designDocPath,  // ✅ Add design document file path for environment inference
    designDocs,     // ✅ Add structured design docs for detectEnvironment
    sessionContext: sessionContextForLLM,  // ✅ Include compressed session context
    profile,  // ✅ ONLY profile!
    referenceContexts,  // Empty array (references loaded per-task)
  };
  
  // ✅ Record phase timing
  result._phaseTimings = { ...(result._phaseTimings || {}), resolve: Date.now() - phaseStart };
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
  }
  
  return result;
}
