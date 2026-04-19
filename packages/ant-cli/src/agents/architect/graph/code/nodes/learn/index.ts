import * as path from "path";
import { ArchitectGraphState } from "../../state";
import { SessionRun, ConversationEntry } from "../../../../../../core/types";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { buildConsumedMeta, writeDocMeta, readDocMeta } from "../../../../../../core/utils/docMetadata";
import { designSubdirOf, DESIGN_DIR, BOUNDARY } from "@ant/shared";
import type { FeatureBoundaryLine } from "@ant/shared";

import { buildJobRecord } from './jobRecord';
import { extractCodeLessons, extractTags } from './lessonExtractor';
import {
  buildBreadcrumb,
  collectTouchedFilesFromTrace,
} from '../../../../../../core/context/breadcrumb';

class LessonQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private readonly maxConcurrent = 2;

  async add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          await task();
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processNext();
        }
      };

      this.queue.push(wrappedTask);
      this.processNext();
    });
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (task) {
      this.running++;
      task().catch(() => {});
    }
  }

  getStats() {
    return {
      queued: this.queue.length,
      running: this.running,
      total: this.queue.length + this.running
    };
  }
}

const lessonQueue = new LessonQueue();

/**
 * §2.4 Breadcrumb / Boundary policy (session redesign).
 *
 * Observation targets (matrix rows):
 *   - mode !== 'explain' && complexity === 'todo'
 *       → append BC + Boundary (full write)
 *   - mode !== 'explain' && complexity === 'exploratory' && touched ≥ 3
 *       → append BC only (mini-BC; no Boundary so the user_turn stays in T2)
 *   - mode === 'explain' && complexity === 'todo'
 *       → append Boundary only (T1 unchanged; collapse the explainer turn)
 *   - otherwise → no write
 *
 * SSOT for touched files: trace.jsonl `file_write` events attributed to
 * `state.turnId` (see core/context/breadcrumb.ts). Write tools emit these
 * via the tool / direct node hooks.
 *
 * The helper is side-effect only (appends to feature.jsonl); return value
 * is unused. Failures are caller's responsibility to log.
 */
async function applyBreadcrumbBoundaryMatrix(
  state: ArchitectGraphState,
): Promise<void> {
  const session = state.deps?.session;
  if (!session) return;
  const mode = state.resolvedAction?.mode;
  const complexity = state.complexity;
  const jobId = state.jobId;
  const turnId = state.turnId;
  const jobType = 'code' as const;

  if (!jobId || !turnId) {
    // Without turnId the breadcrumb/boundary cannot be attributed. This
    // happens only in tests / resume-without-feature-context; the absence
    // itself is observable (log) and the matrix is skipped safely.
    console.warn('⚠️  [Learn] skip breadcrumb/boundary matrix (missing turnId)');
    return;
  }

  // Matrix row selection — no early return until after classification so
  // the log line explains which branch triggered.
  const isExplain = mode === 'explain';
  let wantBreadcrumb = false;
  let wantBoundary = false;
  let rowLabel = 'noop';

  const touched = await collectTouchedFilesFromTrace(session, turnId);
  const touchedCount = touched.all.size;

  if (!isExplain && complexity === 'todo') {
    wantBreadcrumb = true;
    wantBoundary = true;
    rowLabel = 'todo-full';
  } else if (!isExplain && complexity === 'exploratory' && touchedCount >= 3) {
    wantBreadcrumb = true;
    rowLabel = 'exploratory-mini';
  } else if (isExplain && complexity === 'todo') {
    wantBoundary = true;
    rowLabel = 'explain-boundary';
  }

  console.log(
    `🧭 [Learn] breadcrumb matrix: mode=${mode} complexity=${complexity} touched=${touchedCount} row=${rowLabel}`,
  );

  if (!wantBreadcrumb && !wantBoundary) return;

  if (wantBreadcrumb) {
    const anchorsSource = Array.from(touched.all);
    const summary = buildBreadcrumbSummary({
      directive: state.directive || '',
      touchedCount,
      mode,
    });
    const breadcrumb = buildBreadcrumb({
      jobId,
      turnId,
      jobType,
      mode,
      touched: anchorsSource,
      created: touched.created,
      modified: touched.modified,
      deleted: touched.deleted,
      summary,
      traceRangeRef: touched.range,
    });
    try {
      await session.appendBreadcrumb(breadcrumb);
      console.log(
        `📝 [Learn] breadcrumb appended (scope=${breadcrumb.scope} touched=${touchedCount})`,
      );
    } catch (err) {
      console.warn('⚠️  [Learn] appendBreadcrumb failed:', err);
    }
  }

  if (wantBoundary) {
    const boundary: FeatureBoundaryLine = {
      type: 'boundary',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType,
      reason: 'auto_job_complete_todo',
    };
    try {
      await session.appendBoundary(boundary);
      console.log(`📌 [Learn] boundary appended (reason=${boundary.reason})`);
    } catch (err) {
      console.warn('⚠️  [Learn] appendBoundary failed:', err);
    }
  }
}

/**
 * Build a noun-form one-line summary for the breadcrumb.
 *
 * FPOP constraint (inline contract — no LLM render today):
 *   - Observation target: the job's outcome.
 *   - Principle: single-line noun-form phrase surfacing the artefact.
 *   - Constraint: no verb-form sentences, no concrete file enumerations,
 *     no platform-specific examples (files/counts belong in anchors/stats).
 *
 * The helper sticks to observable state — directive title + optional scale
 * hint — rather than inferring intent from code paths. When an LLM-driven
 * summariser replaces this helper, the same constraint applies; the rules
 * promoted to a template at that point will be wired via `promptBuilder`
 * so the reverse-coverage matrix stays green.
 */
function buildBreadcrumbSummary(input: {
  directive: string;
  touchedCount: number;
  mode?: string;
}): string {
  const directive = (input.directive || '').trim();
  const firstLine = directive.split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  const scale =
    input.touchedCount > 0 ? ` · ${input.touchedCount} files` : '';
  const modeTag = input.mode ? ` · ${input.mode}` : '';
  const core = trimmed.length > 0 ? trimmed : 'code change';
  return `${core}${modeTag}${scale}`;
}

/**
 * Learn node - Incremental lesson extraction after each task completion:
 * 1. Extract lessons from completed task
 * 2. Store lessons to vector DB (ASYNC - non-blocking)
 * 3. Save turn to session file (for context continuity)
 * 4. Route to next task or end
 * 
 * Called after EVERY task completion (not just at the end).
 * Async lesson storage - doesn't block workflow progression.
 * 
 * NOTE: File saving happens in writeFiles node (before validation)
 * This node focuses purely on lesson extraction/metadata artifacts.
 */
export async function learn(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('learn', state.currentTask ?? undefined);

  // Clean up running servers before completing
  if (state.runningServers && state.runningServers.length > 0) {
    console.log(`\n🧹 [Learn] Cleaning up ${state.runningServers.length} running server(s)...`);
    
    for (const server of state.runningServers) {
      try {
        if (process.platform === 'win32') {
          try {
            const { spawn } = await import('child_process');
            await new Promise<void>((resolve) => {
              const child = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true
              });
              child.on('exit', () => resolve());
              child.on('error', () => resolve());
            });
          } catch {
            process.kill(server.pid, 'SIGTERM');
          }
        } else {
          try {
            process.kill(-server.pid, 'SIGTERM');
          } catch {
            process.kill(server.pid, 'SIGTERM');
          }
        }
        console.log(`   ✅ Killed: ${server.command} (PID ${server.pid})`);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          process.kill(server.pid, 0);
          console.log(`   ⚠️  Process still running, escalating to SIGKILL...`);
          if (process.platform === 'win32') {
            try {
              const { spawn } = await import('child_process');
              await new Promise<void>((resolve) => {
                const child = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
                  stdio: 'ignore',
                  windowsHide: true
                });
                child.on('exit', () => resolve());
                child.on('error', () => resolve());
              });
            } catch {
              process.kill(server.pid, 'SIGKILL');
            }
          } else {
            try {
              process.kill(-server.pid, 'SIGKILL');
            } catch {
              process.kill(server.pid, 'SIGKILL');
            }
          }
        } catch (e) {
          // Process already terminated
        }
      } catch (e: any) {
        if (e.code === 'ESRCH') {
          console.log(`   ℹ️  Already stopped: ${server.command} (PID ${server.pid})`);
        } else {
          console.log(`   ⚠️  Failed to kill ${server.command} (PID ${server.pid}): ${e.message}`);
        }
      }
    }
    
    state.runningServers = [];
    console.log(`   ✅ Server cleanup complete\n`);
  }
  
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
      state._httpJobId, 
      'learn', 
      state.workerId ?? 0,
      taskInfo, 
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // Generate quality evaluation report
  const filePaths = state.projectCodeContext?.filePaths || [];
  if (filePaths.length > 0) {
    try {
      const gitPort = state.gitPort || state.deps?.git;
      const fileSystem = state.deps?.fileSystem;
      if (gitPort && fileSystem) {
        const { generateQualityReport } = await import('./qualityReport');
        const report = await generateQualityReport(state, gitPort, fileSystem);
        if (report) {
          state.evaluationReport = report;
        }
      }
    } catch (error) {
      console.warn('⚠️  Quality report generation failed:', error);
    }
  }
  
  // Extract lessons
  const lessons = extractCodeLessons(state);
  
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for branch management");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  
  const lessonMetadata = {
    relatedFiles: filePaths,
    tags: extractTags(lessons, state.directive || ''),
    directive: state.directive,
    taskType: state.currentTask?.type,
    branch: branch
  };
  
  if (filePaths.length > 0) {
    console.log(`\n✏️  ${filePaths.length} files modified:`);
    for (const fp of filePaths) {
      console.log(`   - ${fp}`);
    }
  }
  
  const filesWritten = filePaths.length;
  
  // Save run to session file first (to get sessionId and runId)
  const _workerId = state.workerId;
  const isWorkerContext = _workerId !== undefined && _workerId !== null;

  if (!isWorkerContext && state.figmaAvailable) {
    try {
      const { saveFigmaMCPDebugLog } = await import('../../../../../../periphery/adapters/figma/figmaMCPHandler');
      await saveFigmaMCPDebugLog(state.context?.featurePath || '', state._httpJobId || '');
    } catch { /* non-blocking */ }
  }

  const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();

  const orchestratorReasons = ['tasks_failed', 'recursion_limit', 'consecutive_timeouts'];
  const orchestratorInterruptionReason = state.interruption?.reason;
  if (
    isLastTask &&
    orchestratorInterruptionReason !== undefined &&
    orchestratorReasons.includes(orchestratorInterruptionReason)
  ) {
    const failedTasks = state.failedTasks;
    if (failedTasks && failedTasks.length > 0) {
      console.log(`⚠️  [Learn] ${failedTasks.length} task(s) failed — preserving ${orchestratorInterruptionReason} interruption`);
    } else {
      console.log(`✅ [Learn] All tasks completed — clearing stale ${orchestratorInterruptionReason} interruption`);
      state.interruption = undefined;
    }
  }

  const hasOrchestratorFailure = state.interruption?.reason === 'tasks_failed'
    || state.interruption?.reason === 'recursion_limit'
    || state.interruption?.reason === 'consecutive_timeouts';
  
  let sessionId: string | undefined;
  let runId: number | undefined;
  
  if (state.deps?.session && !isWorkerContext && !hasOrchestratorFailure) {
    const session = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    sessionId = session.sessionId;
    
    const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
    const poolView = new ArtifactPoolView(state.artifacts || []);
    const firstDesign = poolView.firstDesignContent();
    const inputSummary = firstDesign
      ? `Design: ${firstDesign.substring(0, 150)}...`
      : `Directive: ${(state.directive || '').substring(0, 150)}...`;
    
    const run: SessionRun = {
      runId: 0,
      job: 'code',
      timestamp: new Date().toISOString(),
      input: {
        type: 'design',
        source: firstDesign ? 'outputs/design/system/[latest]' : 'directive',
        summary: inputSummary.substring(0, 200),
        size: firstDesign?.length || (state.directive || '').length,
      },
      output: {
        branch: branch,
        filesWritten: filesWritten,
        files: filePaths,
        modifications: filePaths.length > 0 ? [...filePaths] : []
      }
    };
    
    await state.deps.session.addRun(
      state.context.project,
      state.context.featureFolder || 'default',
      'code',
      run
    );
    
    const updatedSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    runId = updatedSession.runs[updatedSession.runs.length - 1]?.runId;
    
    const existingSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    
    const taskFailed = state.violations && state.violations.length > 0;
    const completedJobTiming = state.jobTiming ? {
      ...state.jobTiming,
      ...(isLastTask && !taskFailed && { completedAt: new Date().toISOString() })
    } : undefined;
    
    if (isLastTask && taskFailed) {
      state.interruption = {
        reason: 'verification_failed',
        message: `Task "${state.currentTask?.name}" failed after ${state.retries} retries with unresolved violations`,
        timestamp: new Date().toISOString(),
        canResume: true,
        failedTask: state.currentTask?.name,
        violations: (state.violations || []).slice(0, 3).map(v => ({
          type: v.type,
          message: typeof v.message === 'string' ? v.message.substring(0, 200) : String(v.message),
        })),
      };
      console.warn(`⚠️  [Learn] Last task failed with ${state.violations!.length} violation(s) — NOT marking job as completed`);
    }
    
    let directivesArray: string[] = [];
    if (state.directive) {
      if (state.directive.includes('\n\n---\n\n')) {
        directivesArray = state.directive.split('\n\n---\n\n').filter(d => d.trim());
      } else {
        directivesArray = [state.directive];
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Session redesign §2.4 — Breadcrumb / Boundary policy matrix.
    // Runs once at the end of a code job (isLastTask) to capture the
    // job's trace into feature.jsonl for future resolve/plan/direct use.
    // Invoked before jobConversation legacy block (kept below but
    // commented out under TODO(legacy_cleanup) for §14).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (isLastTask && !taskFailed) {
      try {
        await applyBreadcrumbBoundaryMatrix(state);
      } catch (err) {
        console.warn('⚠️  [Learn] breadcrumb/boundary matrix failed:', err);
      }
    }

    // TODO(legacy_cleanup): removed in §14 along with SessionState.jobConversation.
    // Kept as a documentation reference for the Phase C migration; runtime
    // behaviour is now handled by the breadcrumb/boundary matrix above.
    let updatedJobConversation = existingSession.state?.jobConversation;
    void buildJobRecord;
    void BOUNDARY;
    void (null as unknown as ConversationEntry);
    // if (isLastTask && !taskFailed) {
    //   const { user: jobUser, assistant: jobAssistant } = buildJobRecord(state);
    //   const existingJobConv: ConversationEntry[] = existingSession.state?.jobConversation || [];
    //   updatedJobConversation = [...existingJobConv, jobUser, jobAssistant];
    //   console.log(`📋 [Learn] Inter-Job Context: appended raw record (${updatedJobConversation.length} total entries, boundary=${state.boundary || BOUNDARY.LIGHTWEIGHT})`);
    // }
    if (isLastTask && !taskFailed) {
      // Mark consumed documents with metadata
      if (state.deps?.fileSystem && state.context.featurePath) {
        try {
          const rootPath = state.deps.fileSystem.getRootPath?.() || '';
          const featureDirRel = rootPath
            ? path.relative(rootPath, state.context.featurePath)
            : state.context.featurePath.replace(/^\//, '');
          const jobId = state.jobId || 'unknown';
          const meta = buildConsumedMeta(jobId);

          const markFile = async (filename: string) => {
            const subdir = designSubdirOf(filename);
            const isJson = filename.endsWith('.json');
            for (const dir of [path.join(featureDirRel, 'outputs/design', subdir), path.join(featureDirRel, 'outputs/design')]) {
              const filePath = path.join(dir, filename);
              if (await state.deps!.fileSystem!.fileExists(filePath)) {
                const content = await state.deps!.fileSystem!.readFile(filePath);
                if (content) {
                  const existing = readDocMeta(content, isJson);
                  if (existing?.status === 'consumed') return;
                  const updated = writeDocMeta(content, meta, isJson);
                  await state.deps!.fileSystem!.writeFile(filePath, updated);
                  console.log(`📋 [Learn] Marked as consumed: ${filename}`);
                }
                return;
              }
            }
          };

          if (state.selectedSpec) await markFile(state.selectedSpec);
        } catch (err: any) {
          console.warn(`⚠️  [Learn] Failed to mark consumed documents: ${err.message}`);
        }
      }
    }

    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder || 'default',
      'code',
      {
        activeBranch: branch,
        state: {
          taskQueue: state.taskQueue?.getAll() || [],
          currentTask: state.currentTask,
          completedTasks: state.completedTasks || [],
          completedTasksDetails: state.completedTasksDetails || [],
          retries: state.retries,
          maxRetries: state.maxRetries,
          previousAttempts: state.previousAttempts || [],
          enforcementHistory: state.enforcementHistory || [],
          lastViolations: state.lastViolations || [],
          previousFileCount: state.previousFileCount,
          resolvedCategories: state.resolvedCategories || [],
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          interruption: isLastTask
            ? (taskFailed ? state.interruption : undefined)
            : (existingSession.state?.interruption || state.interruption),
          jobId: state.jobId,
          jobTiming: completedJobTiming,
          tokenUsage: state.tokenUsage,
          directives: directivesArray,
          overrideDirective: state.overrideDirective,
          chatSource: state.chatSource,
          referenceRequests: state.referenceRequests || [],
          resolvedAction: state.resolvedAction,
          jobConversation: updatedJobConversation,
        }
      }
    );
    
    console.log(`💾 Session run saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/code.json`);
    if (state.taskQueue && !state.taskQueue.isEmpty()) {
      console.log(`💾 State snapshot saved: ${state.completedTasks?.length || 0} completed, ${state.taskQueue.size()} remaining`);
    }
  }
  
  // ASYNC lesson storage - Store to vector DB without blocking workflow
  if (state.deps?.memory && state.deps?.chunk) {
    const deps = {
      chunk: state.deps.chunk,
      memory: state.deps.memory
    };
    const taskName = state.currentTask?.name || 'unknown';
    const contextData = {
      project: state.context.project,
      feature: state.context.featureFolder || 'default'
    };
    
    const queueStats = lessonQueue.getStats();
    console.log(`\n🎓 [Async Lesson] Queuing lesson storage for: ${taskName}`);
    console.log(`   Queue status: ${queueStats.running} running, ${queueStats.queued} queued`);
    
    lessonQueue.add(async () => {
      try {
        console.log(`\n🎓 [Async Learning] Processing task: ${taskName}`);
        
        const result = await deps.chunk.process({
          source: 'code-lesson',
          sourceType: 'text',
          content: lessons,
          metadata: {
            type: 'lesson',
            job: 'code',
            project: contextData.project,
            feature: contextData.feature,
            timestamp: new Date().toISOString(),
            taskName: taskName,
            sessionId: sessionId,
            runId: runId,
            relatedFiles: (lessonMetadata.relatedFiles || []).join(','),
            tags: (lessonMetadata.tags || []).join(','),
            directive: lessonMetadata.directive,
            taskType: lessonMetadata.taskType,
            branch: lessonMetadata.branch
          }
        });
        
        console.log(`📚 [Async Learning] Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
        
        const documents = result.chunks.map(chunk => ({
          content: chunk.text,
          metadata: chunk.metadata
        }));
        
        if (!deps.memory) {
          throw new Error('Memory adapter not available');
        }
        if (typeof deps.memory.store !== 'function') {
          throw new Error(`Memory adapter store is not a function. Type: ${typeof deps.memory.store}`);
        }
        await deps.memory.store(documents, contextData.project);
        
        console.log(`✅ [Async Lesson] ${result.chunks.length} lesson chunks stored to memory (batch)`);
        if (sessionId && runId) {
          console.log(`🔗 [Async Learning] Linked to session: ${sessionId}, run: ${runId}`);
        }
      } catch (error) {
        console.error('⚠️  [Async Lesson] Failed to store lessons to memory:', error instanceof Error ? error.message : error);
        console.log('   Workflow continues without memory storage...');
      }
    }).catch(() => {});
    
    console.log(`🚀 [Learn] Background lesson storage queued, continuing workflow...\n`);
  } else {
    console.log(`ℹ️  [Learn] Memory/Chunk ports not available, skipping lesson storage\n`);
  }
  
  // Chat UI: Show learning -> learned status
  if (!isWorkerContext && !hasOrchestratorFailure) {
    const chatAPI = getChatAPIClient();
    
    try {
      const learningIndex = await chatAPI.showChatStatus('learning', {
        taskName: state.currentTask?.name || 'Unknown task',
        filesWritten: 0,
        branch: null
      });
      
      await chatAPI.showChatStatus('learned', {
        filesWritten: filesWritten,
        branch: branch,
        content: `Lessons learned!`,
        _mergeIndex: learningIndex
      });
      console.log(`   ✅ Chat UI update successful (learning → learned)\n`);
    } catch (error: any) {
      console.error(`   ❌ Chat UI update FAILED:`, error.message);
    }
  } else if (isWorkerContext) {
    console.log(`   ℹ️  [Learn] Skipping chat status in worker context (worker ${state.workerId})\n`);
  } else if (hasOrchestratorFailure) {
    console.log(`   ℹ️  [Learn] Skipping chat status — orchestrator reported failure\n`);
  }
  
  // Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'learn', state.workerId ?? 0);
  }
  
  // Update Kanban when transitioning to learn (all tasks completed)
  const _learnWorkerId = state.workerId;
  const _isLearnWorkerContext = _learnWorkerId !== undefined && _learnWorkerId !== null;
  if (!_isLearnWorkerContext && !hasOrchestratorFailure && state.deps?.kanbanUpdate && state._httpJobId) {
    console.log(`\n📋 [Learn] Updating Kanban → All tasks completed`);
    console.log(`   Completed: ${state.completedTasksDetails?.length || 0} tasks`);
    console.log(`   Queue: 0 (all done)\n`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,
      [],
      state.completedTasksDetails || [],
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // Log job_complete event and finalize debug loggers
  if (isLastTask && !_isLearnWorkerContext && state.context?.featurePath && state._httpJobId) {
    const { getExecutionLogger, clearExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
    const { clearTokenLogger } = await import('../../../../../../core/utils/tokenLogger');
    const { clearPromptLogger } = await import('../../../../../../core/utils/promptLogger');
    const execLogger = getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'code',
    });
    const jobTokenUsage = state.tokenUsage;
    const jobTiming = state.jobTiming;
    const startedAt = jobTiming?.startedAt ? new Date(jobTiming.startedAt).getTime() : 0;
    await execLogger.logJobComplete({
      totalTasks: (state.completedTasksDetails || []).length,
      totalTokens: jobTokenUsage?.totalTokens || 0,
      totalInputTokens: jobTokenUsage?.inputTokens || 0,
      totalOutputTokens: jobTokenUsage?.outputTokens || 0,
      totalCacheReadTokens: jobTokenUsage?.cacheReadTokens || 0,
      elapsedMs: startedAt ? Date.now() - startedAt : 0,
    });
    await clearExecutionLogger(state._httpJobId);
    await clearTokenLogger(state._httpJobId);
    clearPromptLogger('code', state._httpJobId);
  }

  return { ...state, branch, filesWritten };
}
