import { ArtifactService } from "../../../../../infrastructure/workspace/ArtifactService";
import { ArchitectGraphState } from "../state";
import { CodebaseRetriever } from "../../../../../core/codebase/CodebaseRetriever";
import { ReferenceContext } from "../../../../../core/codebase/types";
import * as path from "path";
import { getEstimatingLabel, detectUILocale } from "../../../../common/graph/timing/estimatingLabels";
import type { ConversationEntry } from "../../../../../core/types/session";
import { CODE_JOB_COMPACTION_THRESHOLD, CODE_JOB_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS } from "../../../../../core/context/constants";

/**
 * Compress uncompressed heavyweight entries in jobConversation via LLM summarization.
 * Called during resolve (Trigger 2: heavyweight compression).
 */
async function compressHeavyweightEntries(
  entries: ConversationEntry[],
  llm: import('../../../../../core/ports/llm').LLMClient,
  promptPort: import('../../../../../core/ports/prompt').PromptPort,
): Promise<{ entries: ConversationEntry[]; changed: boolean }> {
  let changed = false;
  const result: ConversationEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (
      entry.role === 'assistant' &&
      entry.metadata?.boundary === 'heavyweight' &&
      !entry.metadata?.chapterSummary
    ) {
      const userEntry = result[result.length - 1];
      const jobData = [
        `Directive: ${userEntry?.content || ''}`,
        `Result: ${entry.content}`,
      ].join('\n');

      try {
        const systemPrompt = await promptPort.render('common/compaction/job-summary', { jobData });
        const summaryContent = await llm.invoke(
          [{ role: 'user', content: 'Summarize this job.' }],
          { system: systemPrompt, maxTokens: 2048 }
        );
        result.push({
          ...entry,
          content: summaryContent,
          metadata: { ...entry.metadata, chapterSummary: 'Heavyweight job summary' },
        });
        changed = true;
      } catch (err) {
        console.warn(`⚠️  [Resolve] Heavyweight compression failed, keeping raw entry:`, err);
        result.push(entry);
      }
    } else {
      result.push(entry);
    }
  }
  return { entries: changed ? result : entries, changed };
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
        // Load all design documents from disk (no filtering — decompose handles profile)
        state.designDocs = await ArtifactService.loadDesignDocuments(state.context, gitPort, fileSystem, 'unknown');
        
        // Load spec documents from disk
        const resumeSpecDocs = await ArtifactService.loadSpecDocuments(state.context, gitPort, fileSystem);
        if (Object.keys(resumeSpecDocs).length > 0) {
          state.specDocs = resumeSpecDocs;
        }

        // Load single design doc as fallback for state.design
        const designResult = await ArtifactService.findLatestDesign(state.context, gitPort, fileSystem);
        if (designResult?.content) {
          state.design = designResult.content;
          state.designDocPath = designResult.filePath;
        }

        const source = await ArtifactService.getSource(state.context, gitPort, fileSystem);
        if (source?.prd) state.prd = source.prd;
        if (source?.sourceDocuments) state.sourceDocuments = source.sourceDocuments;

        state.parsedUiDocs = await ArtifactService.loadParsedUiContext(state.context, gitPort, fileSystem) || undefined;

        if (!state.profile && state.detectionReport?.profile) {
          state.profile = state.detectionReport.profile;
        }

        console.log(`📄 [Resolve/Resume] design=${!!state.design}, designDocs=${!!state.designDocs}, prd=${!!state.prd}, ui=${!!state.parsedUiDocs}`);
      } catch (error) {
        console.warn(`⚠️  [Resolve/Resume] Failed to reload design artifacts:`, error);
      }
    }

    // ── Figma MCP re-detection on resume (runtime availability may have changed) ──
    state.figmaAvailable = false;
    state.figmaFileKey = undefined;
    state.figmaStartNodeId = undefined;
    try {
      const featurePathResume = state.context.featurePath;
      if (featurePathResume) {
        const pathMod = await import('path');
        const figmaJsonPath = pathMod.join(featurePathResume, 'inputs', 'figma.json');
        const figmaRaw = await state.deps?.fileSystem?.readFile?.(figmaJsonPath);
        if (figmaRaw) {
          const { isFigmaDataPopulated, extractFigmaUrlParts } = await import('@ant/shared');
          const figmaConfig = JSON.parse(figmaRaw);

          if (isFigmaDataPopulated(figmaConfig)) {
            const serverMode = process.env.ANT_SERVER_MODE || 'local';
            let figmaUp = false;
            if (serverMode === 'local') {
              const { checkLocalMCPAvailability } = await import('../../../../../periphery/adapters/figma/MCPTransport');
              figmaUp = await checkLocalMCPAvailability();
            } else {
              const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
              const transport = createMCPTransport({ serverMode: 'cloud', userId: state.context?.userId, redis: state.deps?.redis });
              figmaUp = await transport.isAvailable();
            }

            if (figmaUp && figmaConfig.file) {
              const parts = extractFigmaUrlParts(figmaConfig.file);
              if (parts.fileKey) {
                state.figmaAvailable = true;
                state.figmaFileKey = parts.fileKey;
                state.figmaStartNodeId = parts.nodeId;
              }
            }
          }
        }
      }
      console.log(`🎨 [Resolve/Resume] Figma MCP: ${state.figmaAvailable ? `available (fileKey=${state.figmaFileKey})` : 'unavailable'}`);
    } catch {
      console.log(`🎨 [Resolve/Resume] Figma MCP: detection failed, disabled`);
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
  const { JobTimingManager } = await import('../../../../common/graph/timing/JobTimingManager');
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
            chatSource: state.chatSource,
            userLanguage: state.context.userLanguage,
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
  
  // Load PRD + all source documents (inputs/sources) for detectEnvironment & downstream prompts
  const source = await ArtifactService.getSource(context, gitPort, fileSystem);
  const prd = source?.prd || undefined;
  const sourceDocuments = source?.sourceDocuments;
  
  // Load parsed UI documents for split injection
  const parsedUiDocs = await ArtifactService.loadParsedUiContext(context, gitPort, fileSystem);
  
  console.log(`📄 [Resolve] Design: ${design ? 'loaded' : 'none'}, PRD: ${prd ? 'loaded' : 'none'}, UI: ${parsedUiDocs ? 'loaded' : 'none'}`);

  // ── Figma MCP availability detection (2-stage) ──
  let figmaAvailable = false;
  let figmaFileKey: string | undefined;
  let figmaStartNodeId: string | undefined;

  try {
    const figmaJsonPath = path.join(featurePath, 'inputs', 'figma.json');
    const figmaRaw = await fileSystem?.readFile?.(figmaJsonPath);
    if (figmaRaw) {
      const { isFigmaDataPopulated, extractFigmaUrlParts } = await import('@ant/shared');
      const figmaConfig = JSON.parse(figmaRaw);

      if (isFigmaDataPopulated(figmaConfig)) {
        const serverMode = process.env.ANT_SERVER_MODE || 'local';
        if (serverMode === 'local') {
          const { checkLocalMCPAvailability } = await import('../../../../../periphery/adapters/figma/MCPTransport');
          figmaAvailable = await checkLocalMCPAvailability();
        } else {
          const { createMCPTransport } = await import('../../../../../periphery/adapters/figma/MCPTransport');
          const transport = createMCPTransport({ serverMode: 'cloud', userId: state.context?.userId, redis: state.deps?.redis });
          figmaAvailable = await transport.isAvailable();
        }

        if (figmaAvailable && figmaConfig.file) {
          const parts = extractFigmaUrlParts(figmaConfig.file);
          if (parts.fileKey) {
            figmaFileKey = parts.fileKey;
            figmaStartNodeId = parts.nodeId;
          } else {
            figmaAvailable = false;
          }
        }
      }
    }
  } catch {
    // figma.json missing or malformed — non-critical
  }

  console.log(`🎨 [Resolve] Figma MCP: ${figmaAvailable ? `available (fileKey=${figmaFileKey})` : 'unavailable'}`);

  // ✅ Load all design documents (api-contract-*.md / fe-system-*.md / be-system-*.md)
  const designDocs = await ArtifactService.loadDesignDocuments(context, gitPort, fileSystem, 'unknown');

  // ✅ Load spec documents (spec-{slug}.md) for feature-scoped specifications
  const specDocs = await ArtifactService.loadSpecDocuments(context, gitPort, fileSystem);

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
  
  const sessionContextForLLM = session?.runs && session.runs.length > 0
    ? sessionBuilder.buildContextForLLM(
        session.runs,
        'generate',
        directive || design || ''
      )
    : undefined;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inter-Job Context Bridge: Load & compact jobConversation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const rawJobConversation: ConversationEntry[] = session?.state?.jobConversation || [];
  let processedJobConversation = rawJobConversation;

  if (rawJobConversation.length > 0 && state.deps?.llm && state.deps?.promptEngine?.deps?.promptPort) {
    const promptPort = state.deps.promptEngine.deps.promptPort;

    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity('Compacting previous context...', 'resolve');
    }

    // Trigger 2: Compress uncompressed heavyweight entries
    let compactionChanged = false;
    const trigger2Result = await compressHeavyweightEntries(
      processedJobConversation, state.deps.llm, promptPort
    );
    processedJobConversation = trigger2Result.entries;
    compactionChanged = trigger2Result.changed;

    // Trigger 1: Threshold compaction on entire array
    const { compactJob, applyCompactionToConversation } = await import('../../../../../core/context/compactJob');
    try {
      const compactResult = await compactJob(
        processedJobConversation,
        state.deps.llm,
        promptPort,
        {
          threshold: CODE_JOB_COMPACTION_THRESHOLD,
          recentWindowSize: CODE_JOB_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        }
      );
      if (compactResult.wasCompacted) {
        processedJobConversation = applyCompactionToConversation(
          processedJobConversation,
          { summary: compactResult.summary!, summarizedCount: processedJobConversation.length - CODE_JOB_COMPACTION_WINDOW },
          (summary) => ({
            role: 'system' as const,
            content: summary,
            timestamp: new Date().toISOString(),
            metadata: { chapterSummary: 'Previous jobs summary' },
          })
        );
        compactionChanged = true;
      }
    } catch (err) {
      console.warn(`⚠️  [Resolve] Trigger 1 compaction failed, using uncompacted entries:`, err);
    }

    // Persist only if compaction actually modified entries
    if (compactionChanged && state.deps?.session) {
      try {
        const existingSessionForUpdate = await state.deps.session.load(context.project, context.featureFolder, 'code');
        await state.deps.session.updateArtifacts(context.project, context.featureFolder, 'code', {
          state: { ...existingSessionForUpdate.state, jobConversation: processedJobConversation }
        });
        console.log(`💾 [Resolve] Persisted compacted jobConversation (${rawJobConversation.length} → ${processedJobConversation.length} entries)`);
      } catch (err) {
        console.warn(`⚠️  [Resolve] Failed to persist compacted jobConversation:`, err);
      }
    }

    console.log(`📋 [Resolve] Inter-Job Context: ${processedJobConversation.length} entries loaded`);
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
  // ⚠️ This is NOT for code generation (that's plan + execute)
  //
  let profile = undefined;
  const analyzer = state.deps?.analyzer;
  const referenceContexts: ReferenceContext[] = [];
  
  // Profile detection moved to detectEnvironment node (LLM-based)

  const result = {
    ...state,
    directive,
    prd,
    sourceDocuments,
    parsedUiDocs: parsedUiDocs || undefined,
    design,
    designDocPath,
    designDocs,
    specDocs: Object.keys(specDocs).length > 0 ? specDocs : undefined,
    sessionContext: sessionContextForLLM,
    profile,
    referenceContexts,
    figmaAvailable,
    figmaFileKey,
    figmaStartNodeId,
    jobConversation: processedJobConversation,
  };
  
  // ✅ Record phase timing
  result._phaseTimings = { ...(result._phaseTimings || {}), resolve: Date.now() - phaseStart };
  
  // ✅ Workflow instrumentation: Exit node (success path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'resolve', 0);
  }
  
  return result;
}
