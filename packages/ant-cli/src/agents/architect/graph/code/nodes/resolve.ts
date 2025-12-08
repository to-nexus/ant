import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import { ReferenceContext } from "../../../../../core/codebase/types";
import * as path from "path";

/**
 * Index directive to documents collection (async, non-blocking)
 */
async function indexDirectiveToMemory(
  directive: string,
  project: string,
  feature: string,
  deps: any
): Promise<void> {
  try {
    const { DocumentIndexer } = await import('../../../../../core/documents');
    const documentIndexer = new DocumentIndexer(deps.memory, deps.chunk);
    
    // Generate directive ID
    const timestamp = new Date().toISOString();
    const directiveId = `${project}-${feature}-${timestamp}`;
    
    console.log(`📄 [Code Resolve] Indexing directive (async): ${directiveId.substring(0, 30)}...`);
    
    await documentIndexer.indexDirective(
      directive,
      directiveId,
      {
        project,
        feature,
        tags: extractDirectiveTags(directive)
      }
    );
    
    console.log(`   ✅ Directive indexed to documents-${project}`);
  } catch (error) {
    // Non-fatal
    console.warn('⚠️  Directive indexing failed:', error);
  }
}

/**
 * Extract tags from directive
 */
function extractDirectiveTags(directive: string): string[] {
  const text = directive.toLowerCase();
  const tags: string[] = [];
  
  const keywords = [
    'fix', 'bug', 'error', 'issue',
    'add', 'implement', 'create',
    'refactor', 'optimize', 'improve',
    'ui', 'api', 'database',
    'test', 'documentation'
  ];
  
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      tags.push(keyword);
    }
  }
  
  return tags.slice(0, 5);
}

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
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
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
  const workspaceExists = await gitPort.fileExists(workspacePath);
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
  const featureExists = await gitPort.fileExists(featurePath);
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

  // 1. Load design document (optional)
  const designResult = await ArtifactService.findLatestDesign(context, gitPort);
  const design = designResult?.content || undefined;
  const designDocPath = designResult?.filePath || undefined;

  // 2. Load directive with override priority
  // ✅ Priority: overrideDirective (from chat) > directive.md > directive-nnn.md
  let directive: string | undefined;
  
  if (state.overrideDirective) {
    // ✅ Chat input takes highest priority
    console.log('\n🎯 [Code Resolve] Using override directive from chat input\n');
    directive = state.overrideDirective;
    
    // ✅ NEW: Index directive to documents collection (async, non-blocking)
    if (state.deps?.memory && state.deps?.chunk && directive.length > 50) {
      indexDirectiveToMemory(
        directive, 
        state.context.project, 
        state.context.featureFolder || 'default',
        state.deps
      ).catch(err => {
        console.warn('⚠️  Failed to index directive (non-blocking):', err);
      });
    }
  } else {
    // Load from file system
    directive = await ArtifactService.getDirective(context, 'code', gitPort) || undefined;
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
  
  // ✅ Profile analysis conditions:
  // 1. Analyzer must be available
  // 2. Working directory must exist
  // 3. This is a new job (not resume)
  const shouldAnalyzeProfile = analyzer && context.workingDir && !isResume;
  
  if (shouldAnalyzeProfile) {
    console.log(`📋 [Resolve] Analyzing codebase profile (minimal)...`);
    
    const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    // ✅ Profile analysis: Read ONLY config files directly (no search)
    const configFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js'];
    
    await chatAPI.showChatStatus('retrieving', { query: 'Config files: ' + configFiles.join(', ') });
    
    let profileCode = '';
    const loadedFiles: string[] = [];
    
    for (const filename of configFiles) {
      try {
        const filePath = path.join(context.workingDir, filename);
        const content = await gitPort.readFile(filePath);
        if (content) {
          profileCode += `\n// ${filename}\n${content}\n`;
          loadedFiles.push(filename);
        }
      } catch (error) {
        // File doesn't exist, skip
      }
    }
    
    console.log(`   Retrieved ${loadedFiles.length} config files: ${loadedFiles.join(', ')}`);
    
    await chatAPI.showChatStatus('retrieved', { 
      filesCount: loadedFiles.length,
      filesList: loadedFiles
    });
    
    // Analyze profile from config files
    if (profileCode) {
      try {
        profile = await analyzer.analyze(profileCode, context.workingDir);
        console.log(`   📊 Detected: ${profile.language}${profile.framework ? ` + ${profile.framework}` : ''}`);
      } catch (error) {
        console.warn('   ⚠️  Profile analysis failed:', error);
      }
    }
  } else {
    console.log(`📋 [Resolve] Skipping profile analysis (${!analyzer ? 'no analyzer' : 'resume mode'})`);
  }

  // ✅ Return minimal state (profile only, NO mode - mode determined in detectEnvironment)
  const result = {
    ...state,
    directive,
    design,
    designDocPath,  // ✅ Add design document file path for environment inference
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
