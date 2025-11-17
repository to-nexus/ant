import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { DesignGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import * as path from "path";

/**
 * Design Resolve Node
 * 
 * Strategy: Load based on design mode
 * - greenfield: PRD only (no codebase)
 * - evolution: PRD + current codebase (Phase 1: CodebaseRetriever)
 * - refactor: Current codebase + previous design (Phase 1: CodebaseRetriever)
 * 
 * Always load directive if available
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export async function resolve(state: DesignGraphState): Promise<DesignGraphState> {
  const { designMode } = state;
  const context = state.context; // Use directly from state
  const retriever = new CodebaseRetriever();
  
  // ✅ CRITICAL: Skip validation if resuming (taskQueue already exists)
  const isResume = state.taskQueue && !state.taskQueue.isEmpty();
  if (isResume) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 DESIGN AGENT - RESUME (Skip Resolve)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ Resuming from previous state (resolve phase skipped)');
    if (state.taskQueue) {
      console.log(`   Task queue: ${state.taskQueue.size()} tasks remaining\n`);
    }
    
    // Return existing state without changes
    return state;
  }
  
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

  // 1. Load PRD (optional)
  let prd: string | undefined;
  try {
    const source = await ArtifactService.getSource(context, gitPort);
    prd = source?.prd || undefined;
  } catch (error) {
    // PRD not found - might be refactor mode without PRD
    prd = undefined;
  }

  // 2. Load directive with override priority
  // ✅ Priority: overrideDirective (from chat) > directive.md > directive-nnn.md
  let directive: string | undefined;
  
  if (state.overrideDirective) {
    // ✅ Chat input takes highest priority
    console.log('\n🎯 [Design Resolve] Using override directive from chat input\n');
    directive = state.overrideDirective;
  } else {
    // Load from file system
    directive = await ArtifactService.getDirective(context, 'design', gitPort) || undefined;
  }

  // 3. Load previous design (optional)
  const design = await ArtifactService.findLatestDesign(context, gitPort) || undefined;

  // 4. Load codebase (conditional on mode - Phase 1: CodebaseRetriever)
  let code: string | undefined;
  let codeHead: string | undefined;
  let profile = undefined;
  
  const needsCodebase = designMode === 'evolution' || designMode === 'refactor';
  
  if (needsCodebase) {
    console.log(`🔍 Retrieving codebase for ${designMode} mode...`);
    
    // ✅ Get ChatAPI client for grepping tracking
    const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    // ✅ Send grepping status
    const query = (directive || design || prd || "").slice(0, 100);  // First 100 chars as query
    await chatAPI.addGreppingStatus(query, 0, 25);  // Max 25 files
    
    const codeContext = await retriever.retrieve(
      directive || design || prd || "",
      context.workingDir,
      {
        git: state.deps?.git,
        vectorDB: state.deps?.memory  // ✅ IMPROVEMENT: Enable Vector DB for design too
      },
      {
        maxTokens: 80000,  // ~60KB (smaller for design)
        maxFiles: 25,
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
    
    code = codeContext.code;
    codeHead = codeContext.codeHead;
    
    // Analyze codebase
    const analyzer = state.deps?.analyzer;
    if (code && analyzer) {
      try {
        profile = await analyzer.analyze(code, context.workingDir);
        console.log(`📊 Detected: ${profile.language}${profile.framework ? ` + ${profile.framework}` : ''}`);
      } catch (error) {
        console.warn('⚠️  Failed to analyze codebase:', error);
      }
    }
  }

  // Validation based on mode
  if (designMode === 'greenfield' && !prd) {
    throw new Error("Greenfield mode requires PRD document");
  }
  
  if (designMode === 'refactor' && !code) {
    throw new Error("Refactor mode requires existing codebase");
  }

  return {
    ...state,
    prd,
    directive,
    design,
    code,
    codeHead,
    profile,
  };
}
