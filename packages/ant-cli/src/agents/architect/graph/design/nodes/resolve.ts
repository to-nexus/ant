import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { WorkspacePathResolver } from "../../../../../infrastructure/workspace/WorkspaceResolver";
import { DesignGraphState } from "../state";
import * as path from "path";
import { getEstimatingLabel, detectUILocale } from "../../common/timing/estimatingLabels";

/**
 * Design Resolve Node
 * 
 * Loads artifacts for design generation:
 * - PRD document
 * - Directive (chat override or file)
 * - Previous design document
 * 
 * Design job does NOT load codebase — code analysis is code job's responsibility.
 */
export async function resolve(state: DesignGraphState): Promise<DesignGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Detect UI locale from directive (first node to run)
  const effectiveDirective = state.overrideDirective || state.directive || '';
  state._uiLocale = detectUILocale(effectiveDirective);
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', state._uiLocale), 'resolve');
  }
  
  const jobMode = state.detectionReport?.jobMode;
  const context = state.context;
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'resolve');
  }
  
  // ✅ CRITICAL: Skip artifact loading if resuming (state already restored by runner)
  if (state.isResume) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 DESIGN AGENT - RESUME (Skip Resolve)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const hasTaskQueue = state.taskQueue && !state.taskQueue.isEmpty();
    const hasDetectionReport = Boolean(state.detectionReport);
    const hasNewDirective = Boolean(state.overrideDirective);
    console.log(`   isResume: true`);
    console.log(`   hasTaskQueue: ${hasTaskQueue} (${state.taskQueue?.size() || 0} tasks)`);
    console.log(`   hasDetectionReport: ${hasDetectionReport}`);
    console.log(`   hasNewDirective: ${hasNewDirective}`);
    console.log(`   → Router will decide next node\n`);
    
    // ✅ Record phase timing
    state._phaseTimings = { ...(state._phaseTimings || {}), resolve: Date.now() - phaseStart };
    
    // Return existing state without changes (router decides next node)
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

  // Validation based on mode
  if (jobMode === 'generate' && !prd) {
    throw new Error("Generate mode requires PRD document");
  }

  return {
    ...state,
    prd,
    directive,
    design,
    overrideDirective: state.overrideDirective,
    chatSource: state.chatSource,
    _httpJobId: state._httpJobId,
    _phaseTimings: { ...(state._phaseTimings || {}), resolve: Date.now() - phaseStart },
  };
}
