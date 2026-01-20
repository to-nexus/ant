import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { WorkspacePathResolver } from "../../../../../infrastructure/workspace/WorkspaceResolver";
import { DesignGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import * as path from "path";

/**
 * Design Resolve Node
 * 
 * Strategy: Load based on design mode (unified with CodeMode)
 * - generate: PRD only (no codebase)
 * - refactor: Current codebase + previous design (Phase 1: CodebaseRetriever)
 * - explain: Previous design only (no generation)
 * 
 * Always load directive if available
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export async function resolve(state: DesignGraphState): Promise<DesignGraphState> {
  const jobMode = state.detectionReport?.jobMode;
  const context = state.context; // Use directly from state
  const retriever = new CodebaseRetriever();
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'resolve');
  }
  
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
  
  // ✅ Get fileSystem from state
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    throw new Error('FileSystemPort is required for workspace resolution');
  }
  
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

  // 1. Load PRD (optional)
  let prd: string | undefined;
  try {
    const source = await ArtifactService.getSource(context, gitPort, fileSystem);
    prd = source?.prd || undefined;
  } catch (error) {
    // PRD not found - might be refactor mode without PRD
    prd = undefined;
  }

  // ✅ If PRD exists but is still a template placeholder, fail fast with a clear message (generate mode only).
  if (jobMode === 'generate' && !prd) {
    const featurePathAbs = WorkspacePathResolver.resolveFeaturePath(context);
    const sourceDirAbs = path.join(featurePathAbs, "inputs/sources");
    // toWorkspaceRelative is private, use relative path directly
    const root = (fileSystem as any).getWorkspaceRoot?.() || '';
    const sourceDir = root ? path.relative(root, sourceDirAbs) : sourceDirAbs;
    const prdPath = path.join(sourceDir, 'prd.md');
    if (await fileSystem.fileExists(prdPath)) {
      const raw = await fileSystem.readFile(prdPath);
      if (raw && raw.includes('<!-- ant:template -->')) {
        throw new Error(
          "PRD(prd.md)가 아직 템플릿 상태입니다.\n" +
          "- prd.md 상단의 `<!-- ant:template -->` 줄을 삭제하고 내용을 채워주세요.\n" +
          "- 해당 마커가 남아있으면 시스템은 '비어있는 입력'으로 취급합니다."
        );
      }
    }
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
    directive = await ArtifactService.getDirective(context, 'design', gitPort, fileSystem) || undefined;
  }

  // 3. Load previous design (optional)
  const designResult = await ArtifactService.findLatestDesign(context, gitPort, fileSystem);
  const design = designResult?.content || undefined;

  // 4. Check if UI specification exists (for conditional prompt guidance)
  let hasUiDoc = false;
  try {
    const parsedUiDocs = await ArtifactService.loadParsedUiContext(context, gitPort, fileSystem);
    hasUiDoc = !!(parsedUiDocs && (parsedUiDocs.specSections.size > 0 || parsedUiDocs.tokens || parsedUiDocs.assets));
    if (hasUiDoc) {
      console.log('✅ UI specification detected - system-design will defer UI details to uiDoc');
    }
  } catch (error) {
    // uiDoc not found - that's fine, proceed without it
    hasUiDoc = false;
  }

  // 5. Load codebase (conditional on mode - Phase 1: CodebaseRetriever)
  let code: string | undefined;
  let codeHead: string | undefined;
  let profile = undefined;
  
  const needsCodebase = jobMode === 'refactor';
  
  if (needsCodebase) {
    console.log(`🔍 Retrieving codebase for ${jobMode} mode...`);
    
    // ✅ Get ChatAPI client for grepping tracking
    const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    // ✅ Send retrieving status
    const query = (directive || design || prd || "").slice(0, 100);  // First 100 chars as query
    const mergeIndex = await chatAPI.showChatStatus('retrieving', { query });  // Max 25 files
    
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
    
    // ✅ Send retrieved result
    await chatAPI.showChatStatus('retrieved', {
      filesCount: codeContext.stats.filesLoaded,
      filesList: codeContext.files?.map(f => typeof f === 'string' ? f : f.path) || [],
      _mergeIndex: mergeIndex
    });
    
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
  if (jobMode === 'generate' && !prd) {
    throw new Error("Generate mode requires PRD document");
  }
  
  if (jobMode === 'refactor' && !code) {
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
    hasUiDoc,  // ✅ UI specification existence flag
    overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
    chatSource: state.chatSource,  // ✅ Preserve chat source flag
    _httpJobId: state._httpJobId  // ✅ Preserve jobId
  };
}
