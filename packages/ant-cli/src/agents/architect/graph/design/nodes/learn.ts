import { DesignGraphState } from "../state";
import { SessionRun, ConversationEntry } from "../../../../../core/types";
import { saveFigmaMCPDebugLog } from '../../../tools/figmaMCPHandler';
import { DESIGN_DIR, DESIGN_SUBDIR } from '@ant/shared';

/**
 * Inter-Job Context Bridge: Build raw job completion record.
 * Always saves raw content without LLM summarization.
 * Compression is deferred to next job's resolve node.
 */
function buildDesignJobRecord(state: DesignGraphState): { user: ConversationEntry; assistant: ConversationEntry } {
  const tasks = state.completedTasksDetails || [];
  const files = state.files || [];
  const taskNames = tasks.map((t: any) => t.name).join(', ');
  const timestamp = new Date().toISOString();
  const boundary = state.boundary || 'lightweight';

  const user: ConversationEntry = {
    role: 'user',
    content: state.directive || state.overrideDirective || '',
    timestamp,
    metadata: { jobId: state.jobId || (state as any)._httpJobId, boundary },
  };

  const assistant: ConversationEntry = {
    role: 'assistant',
    content: [
      taskNames && `Tasks: ${taskNames}`,
      files.length > 0 && `Files: ${files.slice(0, 20).map(f => f.path).join(', ')}${files.length > 20 ? '...' : ''}`,
      state.planText && `Plan: ${state.planText.substring(0, 500)}`,
    ].filter(Boolean).join('\n'),
    timestamp,
    metadata: { jobId: state.jobId || (state as any)._httpJobId, boundary, taskCount: tasks.length, filesWritten: files.length },
  };

  return { user, assistant };
}

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
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses ports for all infrastructure operations
 * - No direct file system access
 */
export async function learn(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ Increment recursion count (track node execution for UI gauge)
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
      state._httpJobId, 'learn', (state as any).workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }
  
  // ✅ Update Kanban to show all tasks completed
  // Skip in worker context — orchestrator handles kanban for parallel mode
  // (worker's learn would overwrite multi-task kanban with only this worker's completed tasks)
  const _workerId = (state as any).workerId;
  const _isWorkerContext = _workerId !== undefined && _workerId !== null;
  
  // Clear stale orchestrator interruption when all tasks completed on resume.
  // Without this, hasOrchestratorFailure stays true → learn skips session write
  // even though the job succeeded.
  const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();
  const orchestratorReasons = ['tasks_failed', 'recursion_limit', 'consecutive_timeouts', 'call_limit', 'figma_rate_limited', 'figma_connection_lost'];
  if (isLastTask && orchestratorReasons.includes((state as any).interruption?.reason)) {
    const failedTasks = (state as any).failedTasks;
    if (failedTasks && failedTasks.length > 0) {
      console.log(`⚠️  [Design Learn] ${failedTasks.length} task(s) failed — preserving ${(state as any).interruption.reason} interruption`);
    } else {
      console.log(`✅ [Design Learn] All tasks completed — clearing stale ${(state as any).interruption.reason} interruption`);
      (state as any).interruption = undefined;
    }
  }

  // ✅ Skip session write / Kanban / spec_complete card when parallelOrchestrator
  // already saved failure/interruption state. If learn overwrites it, failedTasks
  // and interruption details are lost (session.state = full replace).
  const hasOrchestratorFailure = (state as any).interruption?.reason === 'tasks_failed'
    || (state as any).interruption?.reason === 'recursion_limit'
    || (state as any).interruption?.reason === 'consecutive_timeouts'
    || (state as any).interruption?.reason === 'call_limit'
    || (state as any).interruption?.reason === 'figma_rate_limited'
    || (state as any).interruption?.reason === 'figma_connection_lost';
  const hasDesignError = Boolean(state.designError);
  const hasEarlyTermination = hasOrchestratorFailure || hasDesignError;

  if (hasDesignError && !_isWorkerContext) {
    try {
      const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
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
      null,  // No current task
      [],    // Empty queue
      completedTasksDetails,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ Load files from disk (state.files is reset between tasks)
  // - Design documents: outputs/design/{system,ui,spec}/ (scanner checks subdir then flat legacy)
  const loadedFiles: Array<{ path: string; content: string; actionType: 'create' | 'append' | 'edit' }> = [];
  
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    const fileSystem = state.deps.fileSystem;
    
    // FileSystemPort expects paths relative to workspace root.
    // featurePath is an absolute path, so convert it.
    const rootPath = fileSystem.getRootPath?.() || '';
    const featureDirRel = rootPath
      ? path.relative(rootPath, state.context.featurePath)
      : state.context.featurePath.replace(/^\//, '');
    
    const designDirRel = path.join(featureDirRel, DESIGN_DIR);
    
    const isUiDesign = state.detectionReport?.workType === 'ui-design'
      || state.uiDesignSource != null;
    
    if (!state.detectionReport?.workType && state.uiDesignSource) {
      console.warn(`⚠️  [Learn] detectionReport.workType missing — falling back to uiDesignSource="${state.uiDesignSource}"`);
    }

    const targetSubdir = isUiDesign ? DESIGN_SUBDIR.UI : DESIGN_SUBDIR.SYSTEM;
    const subDirRel = path.join(designDirRel, targetSubdir);
    console.log(`📂 [Learn] Checking ${isUiDesign ? 'UI Design' : 'System Design'} files in outputs/design/${targetSubdir}/...`);
    
    try {
      // Scan subdirectory first, then flat fallback
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
  
  // ✅ Update state.files for downstream processing (lessons extraction, session save, etc.)
  state.files = loadedFiles;
  
  // 1. Extract lessons from design process
  const lessons = extractDesignLessons(state);
  
  // 2. Save turn to session file
  // Skip when orchestrator already saved failure state — overwriting would lose failedTasks/interruption
  let sessionId: string | undefined;
  let runId: number | undefined;
  
  if (state.deps?.session && !_isWorkerContext && !hasEarlyTermination) {
    await saveSessionRun(state);
    
    // Get session IDs for memory linking
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'design'
    );
    sessionId = session.sessionId;
    runId = session.runs[session.runs.length - 1]?.runId;
    
    console.log(`💾 Session run saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/design.json`);
  }
  
  // 3. Store lessons to vector memory + Index documents
  if (state.deps?.memory && state.deps?.chunk && !hasEarlyTermination) {
    await storeLessonsToMemory(state, lessons, sessionId, runId);
    
    // ✅ Request GC if available (helps with memory pressure before document indexing)
    if (global.gc) {
      global.gc();
      console.log(`🧹 [Design Learn] Requested garbage collection before document indexing`);
    }
    
  }
  
  // ✅ Job completion token usage summary
  if (!_isWorkerContext && !hasEarlyTermination) {
    const jobTokens = (state as any).tokenUsage;
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
  
  // ✅ Flush Figma MCP debug log (cache hits, dedup, rate limits)
  if (!_isWorkerContext) {
    try { await saveFigmaMCPDebugLog(state.context?.featurePath || '', state.jobId || state._httpJobId || ''); } catch { /* non-blocking */ }
  }

  // ✅ Log job_complete to debug/logs/ and cleanup loggers
  if (!_isWorkerContext && state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger, clearExecutionLogger } = await import('../../../../../core/utils/executionLogger');
    const { clearTokenLogger } = await import('../../../../../core/utils/tokenLogger');
    
    if (!hasEarlyTermination) {
      try {
        const jobTokens = (state as any).tokenUsage;
        const jobTiming = (state as any).jobTiming;
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
  }
  
  // ✅ End workflow visualization
  // CRITICAL: Skip in worker context! Each worker runs learn after its task.
  // If worker calls endJob, it prematurely terminates workflow visualization
  // while other workers are still running. Only the MAIN graph's learn should end the job.
  if (!_isWorkerContext && state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.endJob(state._httpJobId);
    console.log(`\n🏁 Job ended: ${state._httpJobId}\n`);
  }
  
  // ✅ Spec completion choice card: offer to start development
  // Skip in worker context (main graph's learn handles it) and when orchestrator had failures
  if (!_isWorkerContext && !hasEarlyTermination && state.detectionReport?.workType === 'spec' && !state.awaitingClarify) {
    try {
      const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
      const chatAPI = getChatAPIClient();

      // Finalize any active main-graph message (e.g. a placeholder-only message
      // started before parallel workers) so the choice card is created as a NEW
      // message that appears at the bottom of the chat history.
      // Without this, the card is silently inserted into an earlier message
      // and the auto-scroll never brings it into view.
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

/**
 * Save session run with all metadata
 */
async function saveSessionRun(state: DesignGraphState): Promise<void> {
  if (!state.deps?.session) return;
  
  const workerId = (state as any).workerId;
  if (workerId !== undefined && workerId !== null) return;
  
  const decisions = extractDesignDecisions(state).split('\n').filter(d => d.trim());
  
  const inputSummary = (state.directive || '').length > 200 
    ? (state.directive || '').substring(0, 197) + '...' 
    : (state.directive || '');
  
  const planLines = state.planText.split('\n');
  const planSummary = planLines.slice(0, 3).join('\n') + (planLines.length > 3 ? '...' : '');
  
  const run: SessionRun = {
    runId: 0, // Will be set by adapter
    job: 'design',
    timestamp: new Date().toISOString(),
    input: {
      type: 'file',
      source: state.sourceDocuments && Object.keys(state.sourceDocuments).length > 0
        ? Object.keys(state.sourceDocuments).map(f => `inputs/sources/${f}`).join(', ')
        : 'inputs/sources/prd.md',
      summary: inputSummary,
      size: (state.directive || '').length,
    },
    output: {
      planSummary: planSummary.substring(0, 300),
      decisionCount: decisions.length,
      fileCount: state.files?.length || 1
    }
  };
  
  await state.deps.session.addRun(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    run
  );
  
  // Load existing session to preserve interruption details
  const existingSession = await state.deps.session.load(
    state.context.project,
    state.context.featureFolder || 'default',
    'design'
  );

  // ✨ Mark job as completed
  const completedJobTiming = (state as any).jobTiming ? {
    ...(state as any).jobTiming,
    completedAt: new Date().toISOString()
  } : undefined;

  // ✅ Build directives array from state.directive (split by separator)
  let directivesArray: string[] = [];
  if (state.directive) {
    if (state.directive.includes('\n\n---\n\n')) {
      directivesArray = state.directive.split('\n\n---\n\n').filter(d => d.trim());
    } else {
      directivesArray = [state.directive];
    }
  }

  // Inter-Job Context Bridge: append raw job record
  const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();
  let updatedJobConversation = existingSession.state?.jobConversation;
  if (isLastTask) {
    const { user: jobUser, assistant: jobAssistant } = buildDesignJobRecord(state);
    const existingJobConv: ConversationEntry[] = existingSession.state?.jobConversation || [];
    updatedJobConversation = [...existingJobConv, jobUser, jobAssistant];
    console.log(`📋 [Design Learn] Inter-Job Context: appended raw record (${updatedJobConversation.length} total entries, boundary=${state.boundary || 'lightweight'})`);
  }

  // Update artifacts with latest design and state
  await state.deps.session.updateArtifacts(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    {
      // ✅ latestDesign path is deterministic - no need to save
      keyDecisions: decisions.slice(0, 5),
      state: {
        taskQueue: state.taskQueue?.getAll() || [],
        currentTask: state.currentTask,
        completedTasks: state.completedTasks || [],
        completedTasksDetails: state.completedTasksDetails || [],
        interruption: existingSession.state?.interruption,
        jobId: (state as any).jobId,  // ✨ Preserve jobId
        jobTiming: completedJobTiming,  // ✨ Mark as completed
        tokenUsage: (state as any).tokenUsage,  // ✅ Preserve job-level token usage
        estimatingTokenUsage: (state as any)._estimatingTokenUsage,  // ✅ Preserve estimating phase breakdown
        directives: directivesArray,  // ✅ Save directives array (newest first)
        overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
        chatSource: state.chatSource,  // ✅ Save chat source flag
        detectionReport: state.detectionReport,  // ✅ Save for resume routing
        jobConversation: updatedJobConversation,
      }
    }
  );
}

/**
 * Store lessons to vector memory with chunking
 */
async function storeLessonsToMemory(
  state: DesignGraphState,
  lessons: string,
  sessionId: string | undefined,
  runId: number | undefined
): Promise<void> {
  if (!state.deps?.chunk || !state.deps?.memory) return;
  
  try {
    // Process through chunking pipeline
    const result = await state.deps.chunk.process({
      source: 'design-lesson',
      sourceType: 'text',
      content: lessons,
      metadata: {
        type: 'lesson',
        job: 'design',
        project: state.context.project,
        feature: state.context.featureFolder || 'default',
        timestamp: new Date().toISOString(),
        // Session tracking for traceability
        sessionId: sessionId,
        runId: runId
      }
    });
    
    console.log(`📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
    
    // Convert chunks to documents
    const documents = result.chunks.map(chunk => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));
    
    // ✅ Use memory adapter from deps
    const memory = state.deps.memory;
    if (!memory || typeof memory.store !== 'function') {
      throw new Error(`Memory adapter is not properly configured. Has store method: ${typeof memory?.store}`);
    }
    
    await memory.store(documents, state.context.project);
    
    console.log(`✅ ${result.chunks.length} lesson chunks stored to memory (batch)`);
    if (sessionId && runId) {
      console.log(`🔗 Linked to session: ${sessionId}, run: ${runId}`);
    }
  } catch (error) {
    // Non-fatal: log error but don't fail workflow
    console.error('⚠️  Failed to store lessons to memory:', error instanceof Error ? error.message : error);
    console.log('   Continuing without memory storage...');
  }
}

/**
 * Extract structured lessons from design generation
 */
function extractDesignLessons(state: DesignGraphState): string {
  const sections: string[] = [];
  
  // 1. Session context
  sections.push(`## Design Session`);
  sections.push(`**Project**: ${state.context.project}`);
  sections.push(`**Feature**: ${state.context.featureFolder || 'main'}`);
  sections.push(`**Timestamp**: ${new Date().toISOString()}`);
  
  // 2. Design approach summary
  if (state.planText) {
    sections.push(`\n## Design Approach Summary`);
    // Extract thinking section if available
    const thinkingMatch = state.planText.match(/=== THINKING ===([\s\S]*?)=== END THINKING ===/);
    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      sections.push(thinking.substring(0, 1500) + (thinking.length > 1500 ? '...' : ''));
    } else {
      sections.push(state.planText.substring(0, 1000) + (state.planText.length > 1000 ? '...' : ''));
    }
  }
  
  // 3. Previous design reference (if refactor)
  if (state.design) {
    sections.push(`\n## Previous Design Reference`);
    const summary = state.design.substring(0, 300);
    sections.push(summary + (state.design.length > 300 ? '...\n[Full previous design available in session artifacts]' : ''));
  }
  
  // 4. Directive applied
  if (state.directive) {
    sections.push(`\n## Directive Applied`);
    if (state.directive.length > 2000) {
      sections.push(state.directive.substring(0, 2000) + '\n...\n[Full directive available in session artifacts]');
    } else {
      sections.push(state.directive);
    }
  }
  
  // 5. Design document summary (from files[])
  sections.push(`\n## Design Document Summary`);
  
  const primaryDesign = state.files?.find(f => 
    f.path.includes('fe-system-') || f.path.includes('be-system-') || f.path.includes('design.md')
  );

  if (primaryDesign) {
    const lines = primaryDesign.content.split('\n').length;
    sections.push(`**File**: ${primaryDesign.path}`);
    sections.push(`**Length**: ${lines} lines`);
    
    // Extract main sections from markdown
    const headings = primaryDesign.content.match(/^#{1,3}\s+(.+)$/gm);
    if (headings && headings.length > 0) {
      sections.push(`\n**Key Sections**:`);
      for (const heading of headings.slice(0, 10)) {
        sections.push(`- ${heading}`);
      }
    }
  } else {
    sections.push(`**No design document generated**`);
  }
  
  // 6. Key design decisions
  sections.push(`\n## Key Design Decisions`);
  sections.push(extractDesignDecisions(state));
  
  return sections.join('\n');
}

/**
 * Extract key design decisions from the design document
 */
function extractDesignDecisions(state: DesignGraphState): string {
  const decisions: string[] = [];
  
  // Get primary design document content
  const primaryDesign = state.files?.find(f => 
    f.path.includes('fe-system-') || f.path.includes('be-system-') || f.path.includes('design.md')
  );
  
  if (!primaryDesign) {
    return '- No design document available for analysis';
  }
  
  const markdown = primaryDesign.content;
  
  // Technology stack
  const techMatch = markdown.match(/(?:technology|tech stack|framework|language)[\s:]+([^\n]+)/i);
  if (techMatch) {
    decisions.push(`- **Technology**: ${techMatch[1].trim()}`);
  }
  
  // Architecture pattern
  const archMatch = markdown.match(/(?:architecture|pattern)[\s:]+([^\n]+)/i);
  if (archMatch) {
    decisions.push(`- **Architecture**: ${archMatch[1].trim()}`);
  }
  
  // Database
  const dbMatch = markdown.match(/(?:database|storage)[\s:]+([^\n]+)/i);
  if (dbMatch) {
    decisions.push(`- **Database**: ${dbMatch[1].trim()}`);
  }
  
  // Fallback if no specific decisions found
  if (decisions.length === 0) {
    decisions.push(`- Design approach documented in ${markdown.split('\n').length} lines`);
  }
  
  return decisions.join('\n');
}

/**
 * Strip _meta field from JSON content
 * _meta is used for chapter tracking during generation, not needed in final output
 */
function stripMetaFromContent(filename: string, content: string): string {
  const isJsonFile = filename.endsWith('.json');
  
  if (isJsonFile) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && '_meta' in parsed) {
        const { _meta, ...rest } = parsed;
        return JSON.stringify(rest, null, 2);
      }
    } catch {
      // Parse error, return as-is
    }
  }
  
  return content;
}
