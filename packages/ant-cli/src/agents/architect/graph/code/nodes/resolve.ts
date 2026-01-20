import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import { ReferenceContext } from "../../../../../core/codebase/types";
import * as path from "path";

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
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ CRITICAL: Skip resolve if resuming (taskQueue already exists from runner restoration)
  const isResume = state.taskQueue && !state.taskQueue.isEmpty();
  if (isResume) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 CODE AGENT - RESUME (Skip Resolve)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ Resuming from previous state (resolve phase skipped)');
    console.log(`   Task queue: ${state.taskQueue?.size() || 0} tasks remaining`);
    console.log(`   Completed tasks: ${state.completedTasks?.length || 0}\n`);
    
    // ✅ CRITICAL FIX: workspaceConfig missing due to LangGraph state serialization!
    // Reload config from disk if missing
    if (!state.workspaceConfig) {
      console.log(`⚠️  [Resolve] workspaceConfig missing! Reloading from disk...`);
      try {
        const { FileConfigAdapter } = await import('../../../../../periphery/adapters/config/FileConfigAdapter');
        const configAdapter = new FileConfigAdapter();
        const config = await configAdapter.load(state.context.project);
        state.workspaceConfig = config;
        console.log(`✅ [Resolve] workspaceConfig restored from disk\n`);
      } catch (error) {
        console.error(`❌ [Resolve] Failed to reload workspaceConfig:`, error);
      }
    }

    // ✅ NOTE: Runtime assets are NOT auto-synced here.
    // Rationale: In monorepos/multi-app repos, the correct static root (public/, apps/*/public, etc.)
    // must be chosen by the LLM as part of the implementation tasks.

    // ✅ Index runtime assets (text-only) for LLM task planning (do NOT auto-copy)
    try {
      const path = await import('path');
      const fs = await import('fs');

      let featurePathAbs = state.context.featurePath;
      if (!featurePathAbs && state.deps?.workspaceResolver) {
        const userContext = {
          userId: state.context.userId || 'local',
          organizationId: state.context.organizationId || 'local',
          workspacePath: ''
        };
        featurePathAbs = state.deps.workspaceResolver.getFeaturePath(
          userContext as any,
          state.context.project,
          state.context.featureFolder
        );
        state.context.featurePath = featurePathAbs;
      }

      if (featurePathAbs) {
        const assetsRootAbs = path.join(featurePathAbs, 'inputs', 'assets');
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
              const relToFeature = path.relative(featurePathAbs, abs).replace(/\\/g, '/');
              if (relToFeature && !relToFeature.startsWith('..')) files.push(relToFeature);
            }
          }
        };

        if (fs.existsSync(assetsRootAbs)) {
          walk(assetsRootAbs);
        }

        state.runtimeAssetsIndex = { files, count: files.length };
      } else {
        state.runtimeAssetsIndex = { files: [], count: 0 };
      }
    } catch {
      state.runtimeAssetsIndex = { files: [], count: 0 };
    }
    
    // ✅ Workflow instrumentation: Exit node (skip path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve');
    }
    
    // Return existing state without changes
    return state;
  }
  
  // ✅ NEW JOB: Initialize jobId and jobTiming
  const { JobTimingManager } = await import('../../common/timing/JobTimingManager');
  const { jobId: newJobId, jobTiming: newJobTiming } = JobTimingManager.initializeNewJob(state._httpJobId!);
  
  // ✅ CRITICAL: Clear conversation history for NEW JOB
  // Each job starts fresh to maintain task independence and clean context
  console.log(`🧹 [Resolve] Clearing conversation history for NEW JOB`);
  state.conversationHistory = [];
  
  // 💾 Save initial jobTiming to session
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
            overrideDirective: state.overrideDirective,
            chatSource: state.chatSource
          }
        }
      );
      console.log(`💾 [Resolve] Initial jobTiming saved to session\n`);
    } catch (error) {
      console.warn(`⚠️  [Resolve] Failed to save initial jobTiming:`, error);
    }
  }
  
  // ✅ Send "estimating started" signal (empty task list)
  if (state._httpJobId && state.deps?.kanbanUpdate) {
    console.log(`\n🎬 [Resolve] Signaling estimating started...`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,    // no currentTask yet
      [],      // no tasks yet
      [],      // no completed tasks yet
      0,       // recursionCount
      undefined // recursionLimit
    );
    console.log(`   ✅ Estimating signal sent\n`);
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
  
  // ✅ Load PRD (inputs/sources) for detectEnvironment & downstream prompts
  const source = await ArtifactService.getSource(context, gitPort, fileSystem);
  const prd = source?.prd || undefined;
  
  // ✅ Load parsed UI documents (Figma-derived) for split injection
  // Returns structured ParsedUiDocs with sections that can be selectively injected per task
  const parsedUiDocs = await ArtifactService.loadParsedUiContext(context, gitPort, fileSystem);
  
  // Debug: Log UI context loading result
  if (parsedUiDocs) {
    const totalTokens = (parsedUiDocs.tokensTokenEstimate || 0) + 
                        (parsedUiDocs.assetsTokenEstimate || 0) + 
                        parsedUiDocs.specTotalTokens;
    console.log(`📄 [Resolve] parsedUiDocs loaded (~${totalTokens} total tokens)`);
    console.log(`   - tokens: ${parsedUiDocs.tokensTokenEstimate || 0} tokens`);
    console.log(`   - assets: ${parsedUiDocs.assetsTokenEstimate || 0} tokens`);
    console.log(`   - spec: ${parsedUiDocs.specSections.size} sections, ${parsedUiDocs.specTotalTokens} tokens`);
  } else {
    console.log(`⚠️  [Resolve] parsedUiDocs NOT loaded - check outputs/design for ui-spec.json, ui-tokens.json, ui-assets.json`);
  }

  // ✅ Load all available design documents (api-contract / fe / be / system-design)
  // Use ArtifactService to ensure FileSystemPort receives workspace-relative paths
  const designDocs = await ArtifactService.loadDesignDocuments(context, gitPort, fileSystem, 'unknown');

  // ✅ Fallback: if structured designDocs are missing but a legacy/unified design exists, keep it usable
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
    // ✅ Chat input takes highest priority
    console.log('\n🎯 [Code Resolve] Using override directive from chat input\n');
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
  console.log(`💭 Building session context...`);
  
  const { SessionContextBuilder } = await import('../../../../../agents/architect/session/SessionContextBuilder');
  const sessionBuilder = new SessionContextBuilder();
  
  // Get session history
  const session = state.deps?.session 
    ? await state.deps.session.load(context.project, context.featureFolder, 'code')
    : null;
  
  // Build compressed session context for LLM
  // Note: mode will be determined by detectEnvironment node
  const sessionContextForLLM = session?.turns && session.turns.length > 0
    ? sessionBuilder.buildContextForLLM(
        session.turns,
        'generate', // Placeholder, actual mode determined in detectEnvironment
        directive || design || ''
      )
    : undefined;
  
  if (sessionContextForLLM) {
    console.log(`   Session: ${sessionContextForLLM.totalTurns} turns, window=${sessionContextForLLM.windowSize}, compression=${(sessionContextForLLM.compressionRatio * 100).toFixed(0)}%`);
  }
  
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
  
  // ✅ Profile detection moved to detectEnvironment node (LLM-based)
  // Resolve no longer analyzes config files for profile
  // - New projects: No config files exist yet, profile determined from design doc by LLM
  // - Existing projects: Profile determined from existing code patterns by LLM
  console.log(`📋 [Resolve] Profile detection delegated to detectEnvironment node (LLM-based analysis)`);

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
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve');
  }
  
  return result;
}
