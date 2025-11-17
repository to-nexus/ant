import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
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
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'resolve', taskInfo);
  }
  
  const { context } = state;
  const retriever = new CodebaseRetriever();
  
  // Get GitPort for file operations
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
  }

  // 0. Validate workspace exists (WorkspaceResolver 기반)
  const workspaceResolver = context.workspaceResolver;
  if (!workspaceResolver) {
    throw new Error('WorkspaceResolver not provided in context');
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
  const design = await ArtifactService.findLatestDesign(context, gitPort) || undefined;

  // 2. Load directive with override priority
  // ✅ Priority: overrideDirective (from chat) > directive.md > directive-nnn.md
  let directive: string | undefined;
  
  if (state.overrideDirective) {
    // ✅ Chat input takes highest priority
    console.log('\n🎯 [Code Resolve] Using override directive from chat input\n');
    directive = state.overrideDirective;
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

  // 3. Retrieve relevant codebase (Phase 1: Smart Retrieval)
  console.log(`📋 Retrieving relevant codebase...`);
  
  // ✅ Get ChatAPI client for grepping tracking
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  // ✅ Send grepping status
  const query = (directive || design || "").slice(0, 100);  // First 100 chars as query
  await chatAPI.addGreppingStatus(query, 0, 30);  // Max 30 files
  
  const codeContext = await retriever.retrieve(
    directive || design || "",
    context.workingDir,
    {
      git: state.deps?.git,
      vectorDB: state.deps?.memory
    },
    {
      maxTokens: 100000,  // ~75KB
      maxFiles: 30,
      exclude: ['test', 'tests', '__tests__', '*.test.*', '*.spec.*']
    }
  );

  console.log(`✅ Strategy: ${codeContext.strategy}, Files: ${codeContext.stats.filesLoaded}, Tokens: ~${codeContext.stats.estimatedTokens}`);
  
  // ✅ Send grepped result
  await chatAPI.addGreppedResult(
    query,
    codeContext.stats.filesLoaded,
    codeContext.strategy,
    codeContext.files || []
  );

  // 4. Analyze codebase profile
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

  return {
    ...state,
    directive,
    design,
    code: codeContext.code,
    codeHead: codeContext.codeHead,
    profile,
  };
}
