import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { WorkspacePathResolver } from "../../../../../infrastructure/workspace/WorkspaceResolver";
import { DesignGraphState } from "../state";
import * as path from "path";
import { getEstimatingLabel, detectUILocale } from "../../../../common/graph/timing/estimatingLabels";
import { isTemplateContent } from "../../../../../core/utils/templateDetector";

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
  
  // ✅ NEW JOB: Initialize jobTiming BEFORE setEstimatingActivity
  // so the first broadcast already includes timing (matches code job pattern).
  // Without this, design job broadcasts 4 nodes (resolve/triage/detect/decompose)
  // without jobTiming, causing frontend to keep stale completedAt from previous job.
  if (!state.isResume && state._httpJobId) {
    const { JobTimingManager } = await import('../../../../common/graph/timing/JobTimingManager');
    const { jobId: newJobId, jobTiming: newJobTiming } = JobTimingManager.initializeNewJob(state._httpJobId);
    
    // Store on state for downstream nodes (decompose will finalize estimating phase)
    (state as any).jobId = newJobId;
    (state as any).jobTiming = newJobTiming;
    
    // Set on broadcaster so every subsequent broadcast includes timing
    if (state.deps?.kanbanUpdate?.setJobTiming) {
      state.deps.kanbanUpdate.setJobTiming(newJobTiming);
    }
    
    // Save to session early (survives process kill before decompose)
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              jobId: newJobId,
              jobTiming: newJobTiming,
              taskQueue: [],
              completedTasks: [],
              completedTasksDetails: [],
              overrideDirective: state.overrideDirective || state.directive || undefined,
              chatSource: state.chatSource
            }
          }
        );
      } catch (error) {
        // Non-critical: session save failed
      }
    }
  }
  
  // ✅ Node activity banner (now broadcasts WITH jobTiming for new jobs)
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('resolve', state._uiLocale), 'resolve');
  }
  
  const jobMode = state.detectionReport?.jobMode;
  const context = state.context;
  
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'resolve', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit
    );
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
    
    // ✅ existingDesignDocs: always reload from disk (per state.ts contract)
    // NOT stored in session, so must be scanned here even on resume.
    // Without this, detectEnvironment sees hasSystemDocs=false after user_stopped + retry.
    const featurePath = context.featurePath || '';
    if (featurePath) {
      const fs = await import('fs');
      const DESIGN_FILE_PATTERNS = [
        /^api-contract-.+\.md$/,
        /^fe-system-.+\.md$/,
        /^be-system-.+\.md$/,
      ];
      try {
        const designDirAbs = path.join(featurePath, "outputs/design");
        if (fs.existsSync(designDirAbs)) {
          const designEntries = fs.readdirSync(designDirAbs, { withFileTypes: true });
          const designFiles = designEntries.filter(
            (e: any) => !e.isDirectory() && DESIGN_FILE_PATTERNS.some(p => p.test(e.name))
          );
          if (designFiles.length > 0) {
            const reloaded: Record<string, string> = {};
            for (const entry of designFiles) {
              const content = fs.readFileSync(path.join(designDirAbs, entry.name), 'utf-8');
              if (content?.trim()) {
                reloaded[entry.name] = content;
              }
            }
            state.existingDesignDocs = reloaded;
            console.log(`📄 [Design Resolve] Reloaded existingDesignDocs: [${Object.keys(reloaded).join(', ')}]`);
          }
        }
      } catch {
        // Non-critical: design directory may not exist yet
      }
    }
    
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
    const root = fileSystem.getRootPath?.() || '';
    const sourceDir = root ? path.relative(root, sourceDirAbs) : sourceDirAbs;
    const prdPath = path.join(sourceDir, 'prd.md');
    if (await fileSystem.fileExists(prdPath)) {
      const raw = await fileSystem.readFile(prdPath);
      if (raw && isTemplateContent(raw)) {
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

  // 4. Scan existing system design documents (for refactor mode to know exact filenames)
  //    Pattern: api-contract-{name}.md, fe-system-{name}.md, be-system-{name}.md
  const DESIGN_FILE_PATTERNS = [
    /^api-contract-.+\.md$/,
    /^fe-system-.+\.md$/,
    /^be-system-.+\.md$/,
  ];
  let existingDesignDocs: Record<string, string> | undefined;
  try {
    const designDirAbs = path.join(featurePath, "outputs/design");
    if (fs.existsSync(designDirAbs)) {
      const designEntries = fs.readdirSync(designDirAbs, { withFileTypes: true });
      const designFiles = designEntries.filter(
        (e: any) => !e.isDirectory() && DESIGN_FILE_PATTERNS.some(p => p.test(e.name))
      );
      if (designFiles.length > 0) {
        existingDesignDocs = {};
        for (const entry of designFiles) {
          const content = fs.readFileSync(
            path.join(designDirAbs, entry.name), 'utf-8'
          );
          if (content?.trim()) {
            existingDesignDocs[entry.name] = content;
          }
        }
      }
    }
  } catch {
    // Non-critical: design directory may not exist yet
  }

  // Validation based on mode
  if (jobMode === 'generate' && !prd) {
    throw new Error("Generate mode requires PRD document");
  }

  return {
    ...state,
    prd,
    directive,
    design,
    existingDesignDocs,
    overrideDirective: state.overrideDirective,
    chatSource: state.chatSource,
    _httpJobId: state._httpJobId,
    _phaseTimings: { ...(state._phaseTimings || {}), resolve: Date.now() - phaseStart },
    jobId: (state as any).jobId,
    jobTiming: (state as any).jobTiming,
  };
}
