import * as path from "path";
import { ArchitectGraphState } from "../../state";
import { SessionRun } from "../../../../../../core/types";
import { projectSessionStateToKanban } from "../../../../../../core/realtime/projectSessionStateToKanban";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { buildConsumedMeta, writeDocMeta, readDocMeta } from "../../../../../../core/utils/docMetadata";
import { designDirOf, ARTIFACT_PREFIX } from "@ant/shared";

import { extractCodeLessons, extractTags } from './lessonExtractor';
import { evaluateBcGate } from './bcGate';
import { resolveTouchedForLearn } from './resolveTouchedForLearn';
import {
  collectTouchedFilesFromChatLog,
  type TouchedFromChatLog,
} from '../../../../../../core/context/breadcrumb';
import { recordClassification } from '../../../../../../core/utils/featureBiases';
import { PROMOTION_TOUCHED_THRESHOLD } from '@ant/shared';
import { getExecutionTier } from '../../../../../../core/executionTier';
import {
  getExecutionLogger,
  clearExecutionLogger,
  flushExecutionLogger,
} from '../../../../../../core/utils/executionLogger';

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
 * §19 misclassify_guard — append a featureBiases.jsonl sample when the
 * current job shows a signal that Decompose's initial executionTier
 * classification may have been wrong.
 *
 * Trigger conditions (OR):
 *   - `needsEscalation === true` → direct emitted an escalation signal
 *     at least once on this job
 *   - `_promotedThisJob === true` → direct was re-entered after a prior
 *     escalation (strict subset of the above, kept for clarity)
 *   - touched-file count > PROMOTION_TOUCHED_THRESHOLD → exceeded the
 *     same threshold that powers `shouldEscalate`
 *
 * When `state.executionTier` is undefined (no tier prediction on this run)
 * there's nothing to compare against — skip. When `featurePath` is missing
 * (resume-without-context / test harness) — skip.
 *
 * Side-effect only (append). `recordClassification` swallows write
 * failures and returns `false`; the caller uses the return value to
 * avoid logging a misleading "recorded" line on silent failure.
 */
export async function recordClassificationBias(
  state: ArchitectGraphState,
  preComputedTouched?: TouchedFromChatLog,
): Promise<void> {
  const featurePath = state.context?.featurePath;
  const predicted = state.executionTier;
  const jobId = state.jobId;
  const turnId = state.turnId;
  if (!featurePath || predicted === undefined || !jobId || !turnId) return;

  const session = state.deps?.session;
  const touched = preComputedTouched
    ?? (await collectTouchedFilesFromChatLog(session, turnId));
  const actualTouched = touched.all.size;
  const escalated =
    state._promotedThisJob === true || state.needsEscalation === true;

  if (!escalated && actualTouched <= PROMOTION_TOUCHED_THRESHOLD) return;

  const recorded = await recordClassification({
    featurePath,
    jobId,
    predictedTier: predicted,
    actualTouched,
    escalated,
    directive: state.directive,
  });
  if (recorded) {
    console.log(
      `📊 [Learn] featureBiases sample recorded: predictedTier=${predicted} ` +
        `touched=${actualTouched} escalated=${escalated}`,
    );
  }
}

function buildCodeFailureBreadcrumbSummary(input: {
  state: ArchitectGraphState;
  taskFailed: boolean;
  hasOrchestratorFailure: boolean;
}): string | undefined {
  const { state, taskFailed, hasOrchestratorFailure } = input;
  if (!taskFailed && !hasOrchestratorFailure) return undefined;
  const mode = state.resolvedAction?.mode ?? 'generate';
  const taskLabel = state.currentTask?.name || state.currentTask?.type || 'unknown-task';
  if (hasOrchestratorFailure) {
    const reason = state.interruption?.reason ?? 'orchestrator_failure';
    const message = state.interruption?.message || 'job interrupted before completion';
    return `failure: ${reason} · ${mode} · ${message}`;
  }
  return `failure: verification_failed · ${mode} · task "${taskLabel}" has unresolved violations`;
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

  // Clean up running servers before completing.
  //
  // SSOT: this used to be a hand-rolled SIGTERM/SIGKILL escalation, with
  // a separate Windows path. We delegate to DevProcessControl so the same
  // descendant kill + Next dev lock cleanup that PreviewService uses also
  // runs here. A `next dev` started via `run_command keep_running:true`
  // and a `next dev` started by PreviewService now go down the same way,
  // including `.next/dev/server.json` lock removal — which is what was
  // letting verification-time servers block the next preview restart.
  if (state.runningServers && state.runningServers.length > 0) {
    console.log(`\n🧹 [Learn] Cleaning up ${state.runningServers.length} running server(s)...`);

    if (process.platform === 'win32') {
      // DPC's pgrep/lsof primitives are POSIX-only; preserve the legacy
      // taskkill path on Windows.
      const { spawn } = await import('child_process');
      for (const server of state.runningServers) {
        await new Promise<void>((resolve) => {
          const child = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          child.on('exit', () => resolve());
          child.on('error', () => resolve());
        });
        console.log(`   ✅ Killed: ${server.command} (PID ${server.pid})`);
      }
    } else {
      const { getDefaultDevProcessControl } = await import(
        '../../../../../../core/process/DevProcessControl'
      );
      const dev = getDefaultDevProcessControl();

      for (const server of state.runningServers) {
        try {
          await dev.killTree(server.pid, { graceMs: 2_000 });
          // Also clean any framework lock the LLM-spawned dev server may
          // have left behind in its workingDir (e.g. Next dev lock).
          if (server.workingDir) {
            await dev.cleanupStaleLocks(server.workingDir).catch(() => { /* best-effort */ });
          }
          console.log(`   ✅ Killed tree: ${server.command} (PID ${server.pid})`);
        } catch (e: any) {
          if (e?.code === 'ESRCH') {
            console.log(`   ℹ️  Already stopped: ${server.command} (PID ${server.pid})`);
          } else {
            console.log(`   ⚠️  Failed to killTree ${server.command} (PID ${server.pid}): ${e?.message || e}`);
          }
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
  
  // Generate quality evaluation report from disk (tracks files touched this job).
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
  
  // Extract lessons
  const lessons = extractCodeLessons(state);
  
  const gitPort = state.gitPort || state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for branch management");
  }
  
  const branch = state.context.featureFolder
    ? `feature/${state.context.featureFolder}`
    : `feature/${state.context.project}-arch-${Date.now()}`;
  
  // Per-task touched-files SSOT — written by tool handlers
  // (`ToolExecutionContext.recordFileTouch`) and the XML `<file>` streaming
  // path (`FileRenderer.onFileTouched`), both of which push into
  // `currentTask.touchedFiles`. chat.jsonl file_* events are an ephemeral
  // UI feed and MUST NOT be the source here (see cursorrules: session
  // state lives in code.json / feature.jsonl).
  const filePaths = state.currentTask?.touchedFiles ?? [];

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

  if (!isWorkerContext && state.resolvedAction?.mcpSources?.figma != null) {
    try {
      const { saveFigmaMCPDebugLog } = await import('../../../../../../periphery/adapters/figma/figmaMCPHandler');
      await saveFigmaMCPDebugLog(state.context?.featurePath || '', state._httpJobId || '');
    } catch { /* non-blocking */ }
  }

  // SSOT: `_failed:true` markers in the live taskQueue determine whether the
  // persisted interruption still reflects unresolved work. There is no separate
  // `state.failedTasks` channel — the marker on each task IS the signal.
  const queueTasks = state.taskQueue?.getAll() ?? [];
  const failedInQueue = queueTasks.filter(t => (t as { _failed?: boolean })._failed === true);
  const isLastTask = queueTasks.length === 0;

  const orchestratorReasons = ['tasks_failed', 'recursion_limit', 'consecutive_timeouts'];
  const orchestratorInterruptionReason = state.interruption?.reason;
  if (
    orchestratorInterruptionReason !== undefined &&
    orchestratorReasons.includes(orchestratorInterruptionReason)
  ) {
    if (failedInQueue.length > 0) {
      console.log(`⚠️  [Learn] ${failedInQueue.length} task(s) failed — preserving ${orchestratorInterruptionReason} interruption`);
    } else if (isLastTask) {
      console.log(`✅ [Learn] All tasks completed — clearing stale ${orchestratorInterruptionReason} interruption`);
      state.interruption = undefined;
    }
  }

  const hasOrchestratorFailure = state.interruption?.reason === 'tasks_failed'
    || state.interruption?.reason === 'recursion_limit'
    || state.interruption?.reason === 'consecutive_timeouts';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Turn-level touched-files snapshot for featureBiases + breadcrumb.
  //
  // Why dual-source:
  // - chat.jsonl (`collectTouchedFilesFromChatLog`) captures op-level
  //   create/edit/delete metadata but is written fire-and-forget.
  // - `CodeTask.touchedFiles` (currentTask + completedTasksDetails) is
  //   durable in-memory/session state and does not race with async flush.
  //
  // In production we observed turns with many file_edit lines eventually
  // present in chat.jsonl, yet learn's BC gate saw touched=0 at decision
  // time. `resolveTouchedForLearn` merges both sources and prefers the
  // task-state snapshot whenever chat is not yet flushed.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const learnSession = state.deps?.session;
  const chatTouchedForLearn: TouchedFromChatLog | undefined =
    isLastTask && !isWorkerContext && state.turnId && learnSession
      ? await collectTouchedFilesFromChatLog(learnSession, state.turnId)
      : undefined;
  const touchedForLearn: TouchedFromChatLog | undefined = resolveTouchedForLearn({
    chatTouched: chatTouchedForLearn,
    currentTask: state.currentTask,
    completedTasksDetails: state.completedTasksDetails,
  });
  const taskFailed = Boolean(state.violations && state.violations.length > 0);
  const bcGate =
    isLastTask && !isWorkerContext
      ? evaluateBcGate({
          isLastTask,
          taskFailed,
          isWorkerContext,
          hasOrchestratorFailure,
          touchedSize: touchedForLearn?.all.size ?? 0,
          mode: state.resolvedAction?.mode,
          currentTaskType: state.currentTask?.type,
          violationsLen: state.violations?.length ?? 0,
        })
      : undefined;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // §19 misclassify_guard — run BEFORE the session-persistence block.
  //
  // Must not be gated by `!hasOrchestratorFailure`: orchestrator-level
  // failures (tasks_failed / recursion_limit / consecutive_timeouts)
  // are exactly the cases where an under-predicted executionTier tends
  // to blow up the recursion budget or the per-task retry budget. Those
  // are the strongest misclass signals we can collect, so we record
  // them unconditionally. Worker-context calls are still skipped —
  // workers do not own the classification, the main graph does.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isLastTask && !isWorkerContext) {
    try {
      await recordClassificationBias(state, touchedForLearn);
    } catch (err) {
      console.warn('⚠️  [Learn] featureBiases record failed:', err);
    }
  }

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
    
    // Authoritative terminal snapshot: on a SUCCESSFUL job end the child owns
    // the per-jobId run keyed by `state.jobId`, with the final board built
    // from the job's OWN in-process state (not the shared, last-writer-wins
    // `session.state` slot). This makes the completed run jobId-discoverable
    // by the Job-tab restore and immune to a later stale re-finalize
    // (combined with the monotonicity guard in addRun / appendJobSnapshotToSession).
    // The failed case stays owned by the lifecycle API path (broadcastFinalUpdate).
    const isSuccessfulTerminal = isLastTask && !taskFailed && !!state.jobId;
    const terminalSnapshot = isSuccessfulTerminal
      ? projectSessionStateToKanban(
          {
            jobId: state.jobId,
            taskQueue: state.taskQueue?.getAll() ?? [],
            completedTasks: state.completedTasks ?? [],
            completedTasksDetails: state.completedTasksDetails ?? [],
            currentTask: undefined,
            runningTasks: [],
            interruption: undefined,
            recursionCount: state.recursionCount,
            recursionLimit: state.recursionLimit,
            jobTiming: state.jobTiming
              ? { ...state.jobTiming, completedAt: new Date().toISOString() }
              : undefined,
            tokenUsage: state.tokenUsage,
            tokenUsageByModel: state.tokenUsageByModel,
          } as any,
          state.jobId,
          'code',
          false,
        )
      : undefined;

    const run: SessionRun = {
      runId: 0,
      job: 'code',
      timestamp: new Date().toISOString(),
      input: {
        type: 'design',
        source: firstDesign ? 'architecture/system/[latest]' : 'directive',
        summary: inputSummary.substring(0, 200),
        size: firstDesign?.length || (state.directive || '').length,
      },
      output: {
        branch: branch,
        filesWritten: filesWritten,
        files: filePaths,
        modifications: filePaths.length > 0 ? [...filePaths] : []
      },
      ...(isSuccessfulTerminal && {
        jobId: state.jobId,
        kanbanSnapshot: terminalSnapshot,
        status: 'completed' as const,
      }),
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
    // With upsert-by-jobId the terminal run may not be last — find by jobId.
    runId = state.jobId
      ? updatedSession.runs.find((r) => r.jobId === state.jobId)?.runId
      : updatedSession.runs[updatedSession.runs.length - 1]?.runId;
    
    const existingSession = await state.deps.session.load(
      state.context.project,
      state.context.featureFolder || 'default',
      'code'
    );
    
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

          const markFile = async (filename: string, dirHint?: string) => {
            const isJson = filename.endsWith('.json');
            // dirHint is required for spec files whose filenames no longer carry
            // a "spec-" prefix (designDirOf falls back to architecture/system for
            // unprefixed .md). Other artifact kinds keep working via designDirOf.
            const canonicalDir = path.join(featureDirRel, dirHint ?? designDirOf(filename));
            for (const dir of [canonicalDir]) {
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

          // Mark the active spec ref (if any) as consumed. Derived from
          // RAC role='ref' — replaces the legacy `state.selectedSpec` lookup.
          const { ArtifactPoolView } = await import('../../../../../../core/artifact/ArtifactPipeline');
          const activeSpecRefFilename = new ArtifactPoolView(state.artifacts || []).activeSpecRefFilename();
          if (activeSpecRefFilename) await markFile(activeSpecRefFilename, ARTIFACT_PREFIX.SPEC.replace(/\/$/, ''));
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
          tokenUsageByModel: state.tokenUsageByModel,
          directives: directivesArray,
          overrideDirective: state.overrideDirective,
          chatSource: state.chatSource,
          referenceRequests: state.referenceRequests || [],
          resolvedAction: state.resolvedAction,
        }
      }
    );
    
    console.log(`💾 Session run saved to workspace/${state.context.project}/${state.context.featureFolder || 'default'}/sessions/architect/code.json`);
    if (state.taskQueue && !state.taskQueue.isEmpty()) {
      console.log(`💾 State snapshot saved: ${state.completedTasks?.length || 0} completed, ${state.taskQueue.size()} remaining`);
    }
  }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Session redesign §2.4 — Breadcrumb via tier facade.
  //
  // Runs once at the end of a code job (isLastTask). Gate policy:
  //   - success path: `isLastTask && touched>0`
  //   - failure path: `isLastTask && failureSignal` (even touched=0)
  //
  // This keeps successful explain/touched=0 skips unchanged while ensuring
  // failed turns still leave a breadcrumb for the next LLM turn.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (bcGate) {
    console.log(bcGate.diagnosticLine);
    if (bcGate.bcShouldEmit && state.deps?.session) {
      try {
        const executionTier = getExecutionTier(state);
        await executionTier.breadcrumb(state, touchedForLearn, {
          forceEmit: bcGate.failureSignal,
          summaryOverride: buildCodeFailureBreadcrumbSummary({
            state,
            taskFailed,
            hasOrchestratorFailure,
          }),
        });
      } catch (err) {
        console.warn('⚠️  [Learn] tier breadcrumb failed:', err);
      }
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
  
  // Log job_complete event and finalize debug loggers.
  // `flushExecutionLogger` drains every fire-and-forget appendEvent
  // queued by phase nodes (route_decision / plan_finalize / batch_split /
  // tool_call / etc.) so they are guaranteed on disk before the logger
  // is cleared. See executionLogger contract (vast-curling-perch C-3 RCA).
  if (isLastTask && !_isLearnWorkerContext && state.context?.featurePath && state._httpJobId) {
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
    await flushExecutionLogger(state._httpJobId);
    await clearExecutionLogger(state._httpJobId);
    await clearTokenLogger(state._httpJobId);
    clearPromptLogger('code', state._httpJobId);
  }

  return { ...state, branch, filesWritten };
}
