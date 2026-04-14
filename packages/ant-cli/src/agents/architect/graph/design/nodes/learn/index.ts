import { DesignGraphState } from "../../state";
import { saveFigmaMCPDebugLog } from '../../../../../../periphery/adapters/figma/figmaMCPHandler';
import { DESIGN_DIR, DESIGN_SUBDIR } from '@ant/shared';

import { saveSessionRun } from './sessionWriter';
import { extractDesignLessons, storeLessonsToMemory, stripMetaFromContent } from './lessonExtractor';

/**
 * Learn Node - Finalize workflow and store lessons
 * 
 * Responsibilities:
 * 1. Update Kanban to show completion
 * 2. Extract lessons from design process
 * 3. Save turn to session file with metadata
 * 4. Chunk and store lessons to vector memory
 * 5. End workflow visualization
 * 
 * Note: File writing is handled by separate writeFiles node (consistency with code job)
 */
export async function learn(state: DesignGraphState): Promise<DesignGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'learn', state.workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }
  
  const _workerId = state.workerId;
  const _isWorkerContext = _workerId !== undefined && _workerId !== null;
  
  // Clear stale orchestrator interruption when all tasks completed on resume.
  const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();
  const orchestratorReasons = ['tasks_failed', 'recursion_limit', 'consecutive_timeouts', 'call_limit', 'figma_rate_limited', 'figma_connection_lost'];
  const staleOrchReason = state.interruption?.reason;
  if (isLastTask && staleOrchReason != null && orchestratorReasons.includes(staleOrchReason)) {
    const failedTasks = state.failedTasks;
    if (failedTasks && failedTasks.length > 0) {
      console.log(`⚠️  [Design Learn] ${failedTasks.length} task(s) failed — preserving ${staleOrchReason} interruption`);
    } else {
      console.log(`✅ [Design Learn] All tasks completed — clearing stale ${staleOrchReason} interruption`);
      state.interruption = undefined;
    }
  }

  const hasOrchestratorFailure = state.interruption?.reason === 'tasks_failed'
    || state.interruption?.reason === 'recursion_limit'
    || state.interruption?.reason === 'consecutive_timeouts'
    || state.interruption?.reason === 'call_limit'
    || state.interruption?.reason === 'figma_rate_limited'
    || state.interruption?.reason === 'figma_connection_lost';
  const hasDesignError = Boolean(state.designError);
  const hasEarlyTermination = hasOrchestratorFailure || hasDesignError;

  if (hasDesignError && !_isWorkerContext) {
    try {
      const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
      const chatAPI = getChatAPIClient();
      const isKo = state._uiLocale === 'ko' || state._uiLocale !== 'en';
      const errorText = isKo
        ? `❌ **디자인 작업 실패:** ${state.designError!.message}`
        : `❌ **Design job failed:** ${state.designError!.message}`;
      await chatAPI.sendLLMEvent({ type: 'text', text: errorText });
      await chatAPI.finalizeMessage();
    } catch { /* non-blocking */ }
  }
  
  if (!_isWorkerContext && !hasEarlyTermination && state._httpJobId && state.deps?.kanbanUpdate) {
    const completedTasksDetails = state.completedTasksDetails || [];
    
    console.log(`\n🔥 [Learn] Final Kanban update`);
    console.log(`   All tasks completed: ${completedTasksDetails.length}`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,
      [],
      completedTasksDetails,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // Load files from disk (state.files is reset between tasks)
  const loadedFiles: Array<{ path: string; content: string; actionType: 'create' | 'append' | 'edit' }> = [];
  
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    const fileSystem = state.deps.fileSystem;
    
    const rootPath = fileSystem.getRootPath?.() || '';
    const featureDirRel = rootPath
      ? path.relative(rootPath, state.context.featurePath)
      : state.context.featurePath.replace(/^\//, '');
    
    const designDirRel = path.join(featureDirRel, DESIGN_DIR);
    
    const isUiDesign = state.resolvedAction?.intentGroup === 'design-ui'
      || state.resolvedAction?.intent === 'gen-ui-figma'
      || state.resolvedAction?.intent === 'gen-ui-ref'
      || state.resolvedAction?.intent === 'gen-ui-desc'
      || state.resolvedAction?.intent === 'rev-ui';

    const targetSubdir = isUiDesign ? DESIGN_SUBDIR.UI : DESIGN_SUBDIR.SYSTEM;
    const subDirRel = path.join(designDirRel, targetSubdir);
    console.log(`📂 [Learn] Checking ${isUiDesign ? 'UI Design' : 'System Design'} files in outputs/design/${targetSubdir}/...`);
    
    try {
      const filesToProcess: { filename: string; dir: string }[] = [];

      for (const dir of [subDirRel, designDirRel]) {
        if (!(await fileSystem.fileExists(dir))) continue;
        const entries = await fileSystem.readDirectory(dir);

        if (isUiDesign) {
          const expectedFiles = ['ui-tokens.json', 'ui-assets.json', 'ui-spec.json'];
          for (const e of entries) {
            if (!e.isDirectory && expectedFiles.includes(e.name) && !filesToProcess.some(f => f.filename === e.name)) {
              filesToProcess.push({ filename: e.name, dir });
            }
          }
        } else {
          for (const e of entries) {
            if (!e.isDirectory && e.name.endsWith('.md') && !filesToProcess.some(f => f.filename === e.name)) {
              filesToProcess.push({ filename: e.name, dir });
            }
          }
        }
      }
        
      console.log(`📂 [Learn] Loading ${filesToProcess.length} design document(s) from disk...`);
        
      for (const { filename, dir } of filesToProcess) {
        const filePath = path.join(dir, filename);
        let content = await fileSystem.readFile(filePath);
          
        if (content && isUiDesign) {
          content = stripMetaFromContent(filename, content);
          await fileSystem.writeFile(filePath, content);
          console.log(`   🧹 Cleaned _meta from: ${filename}`);
        }
          
        const relativePath = `${dir === subDirRel ? `${DESIGN_DIR}/${targetSubdir}` : DESIGN_DIR}/${filename}`;
          
        loadedFiles.push({
          path: relativePath,
          content: content || '',
          actionType: 'create'
        });
          
        console.log(`   ✅ Loaded: ${filename} (${(content || '').length} chars)`);
      }
    } catch (error) {
      console.warn(`⚠️  [Learn] Failed to load design files:`, error);
    }
  }
  
  if (loadedFiles.length === 0 && !hasEarlyTermination) {
    throw new Error(
      `No design files found under outputs/design/{system,ui,spec}/ — docGen nodes must have run`
    );
  }
  
  state.files = loadedFiles;
  
  // Extract lessons from design process
  const lessons = extractDesignLessons(state);
  
  // Save turn to session file
  let sessionId: string | undefined;
  let runId: number | undefined;
  
  if (state.deps?.session && !_isWorkerContext && !hasEarlyTermination) {
    await saveSessionRun(state);
    
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'
    );
    sessionId = session.sessionId;
    runId = session.runs[session.runs.length - 1]?.runId;
    
    console.log(`💾 Session run saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/design.json`);
  }
  
  // Store lessons to vector memory
  if (state.deps?.memory && state.deps?.chunk && !hasEarlyTermination) {
    await storeLessonsToMemory(state, lessons, sessionId, runId);
    
    if (global.gc) {
      global.gc();
      console.log(`🧹 [Design Learn] Requested garbage collection before document indexing`);
    }
  }
  
  // Job completion token usage summary
  if (!_isWorkerContext && !hasEarlyTermination) {
    const jobTokens = state.tokenUsage;
    if (jobTokens) {
      console.log(`\n📊 [Learn] Job Token Usage Summary:`);
      console.log(`   Total: ${jobTokens.totalTokens || 0} tokens`);
      console.log(`   Input: ${jobTokens.inputTokens || 0}`);
      console.log(`   Output: ${jobTokens.outputTokens || 0}`);
      if (jobTokens.cacheReadTokens) console.log(`   Cache Read: ${jobTokens.cacheReadTokens}`);
      if (jobTokens.cacheCreationTokens) console.log(`   Cache Creation: ${jobTokens.cacheCreationTokens}`);
      console.log(`   Tasks completed: ${(state.completedTasksDetails || []).length}`);
    }
  }
  
  // Flush Figma MCP debug log
  if (!_isWorkerContext) {
    try { await saveFigmaMCPDebugLog(state.context?.featurePath || '', state.jobId || state._httpJobId || ''); } catch { /* non-blocking */ }
  }

  // Log job_complete to debug/logs/ and cleanup loggers
  if (!_isWorkerContext && state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger, clearExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
    const { clearTokenLogger } = await import('../../../../../../core/utils/tokenLogger');
    const { clearPromptLogger } = await import('../../../../../../core/utils/promptLogger');
    
    if (!hasEarlyTermination) {
      try {
        const jobTokens = state.tokenUsage;
        const jobTiming = state.jobTiming;
        const execLogger = getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'design',
        });
        await execLogger.logJobComplete({
          totalTasks: (state.completedTasksDetails || []).length,
          totalTokens: jobTokens?.totalTokens || 0,
          totalInputTokens: jobTokens?.inputTokens || 0,
          totalOutputTokens: jobTokens?.outputTokens || 0,
          totalCacheReadTokens: jobTokens?.cacheReadTokens || 0,
          elapsedMs: jobTiming?.startedAt
            ? Date.now() - new Date(jobTiming.startedAt).getTime()
            : 0,
        });
      } catch (_) { /* non-critical */ }
    }
    
    await clearTokenLogger(state._httpJobId);
    await clearExecutionLogger(state._httpJobId);
    clearPromptLogger('design', state._httpJobId);
  }
  
  // End workflow visualization
  if (!_isWorkerContext && state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.endJob(state._httpJobId);
    console.log(`\n🏁 Job ended: ${state._httpJobId}\n`);
  }
  
  // Spec completion choice card: offer to start development
  if (!_isWorkerContext && !hasEarlyTermination && state.resolvedAction?.intentGroup === 'design-spec' && !state.awaitingClarify) {
    try {
      const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
      const chatAPI = getChatAPIClient();

      await chatAPI.finalizeMessage();
      
      const specFile = state.completedTasksDetails?.[0]?.targetFile 
        || state.files?.[0]?.path?.replace(/^outputs\/design\/(?:spec\/|system\/|ui\/)?/, '')
        || 'spec.md';
      
      const isKo = state._uiLocale === 'ko' || state._uiLocale !== 'en';
      
      await chatAPI.sendChoiceCard({
        type: 'spec_complete',
        title: isKo ? '스펙 작성 완료' : 'Spec Complete',
        choices: [
          {
            id: 'develop',
            label: isKo ? '바로 개발 시작' : 'Start Development',
            action: 'redirect',
            data: { targetJob: 'code', specFile },
          },
          {
            id: 'later',
            label: isKo ? '나중에' : 'Later',
            action: 'dismiss',
          },
        ],
      });
      await chatAPI.finalizeMessage();
    } catch (error) {
      console.warn(`⚠️  [Learn] Failed to send spec completion choice card:`, error);
    }
  }

  return { 
    ...state, 
    lessons
  };
}
