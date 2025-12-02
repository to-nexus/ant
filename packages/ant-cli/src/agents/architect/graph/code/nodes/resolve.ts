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
  
  // ✅ CRITICAL: Skip validation if resuming (taskQueue already exists)
  const isResume = state.taskQueue && !state.taskQueue.isEmpty();
  if (isResume) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 CODE AGENT - RESUME (Skip Resolve)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ Resuming from previous state (resolve phase skipped)');
    if (state.taskQueue) {
      console.log(`   Task queue: ${state.taskQueue.size()} tasks remaining\n`);
    }
    
    // ✅ Workflow instrumentation: Exit node (skip path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve');
    }
    
    // Return existing state without changes
    return state;
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
  
  // 4. Retrieve minimal codebase (Profile analysis only)
  console.log(`📋 Retrieving codebase for profile analysis...`);
  
  // ✅ References are now loaded per-task in plan node
  const referenceContexts: ReferenceContext[] = [];
  
  // ✅ Get ChatAPI client for grepping tracking
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  // ✅ Send grepping status
  const query = (directive || design || "").slice(0, 100);  // First 100 chars as query
  await chatAPI.addGreppingStatus(query, 0, 5);  // Max 5 files (minimal)
  
  const codeContext = await retriever.retrieve(
    directive || design || "",
    context.workingDir,
    {
      git: state.deps?.git,
      vectorDB: state.deps?.memory
    },
    {
      project: context.project,  // ✅ Pass project for Vector DB namespace
      maxTokens: 20000,  // ~15KB (80% reduction from 100K)
      maxFiles: 5,       // Minimal (67% reduction from 15)
      exclude: ['test', 'tests', '__tests__', '*.test.*', '*.spec.*'],
      mode: 'generate' // Default mode for profile analysis (actual mode determined in detectEnvironment)
    }
  );

  console.log(`✅ Strategy: ${codeContext.strategy}, Files: ${codeContext.stats.filesLoaded}, Tokens: ~${codeContext.stats.estimatedTokens}`);
  
  // ✅ Send grepped result
  await chatAPI.addGreppedResult(
    query,
    codeContext.stats.filesLoaded,
    codeContext.strategy,
    codeContext.files?.map(f => typeof f === 'string' ? f : f.path) || []
  );

  // 4. Analyze codebase profile (only purpose of resolve)
  let profile = undefined;
  const analyzer = state.deps?.analyzer;
  
  if (codeContext.code && analyzer) {
    try {
      profile = await analyzer.analyze(codeContext.code, context.workingDir);
      console.log(`📊 Detected: ${profile.language}${profile.framework ? ` + ${profile.framework}` : ''}`);
    } catch (error) {
      console.warn('⚠️  Failed to analyze codebase:', error);
    }
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
