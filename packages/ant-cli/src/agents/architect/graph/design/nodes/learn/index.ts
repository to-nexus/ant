import * as path from 'node:path';
import { DesignGraphState } from "../../state";
import { saveFigmaMCPDebugLog } from '../../../../../../periphery/adapters/figma/figmaMCPHandler';
import { ARTIFACT_PREFIX } from '@ant/shared';

import { saveSessionRun } from './sessionWriter';
import { extractDesignLessons, storeLessonsToMemory, stripMetaFromContent } from './lessonExtractor';
import {
  buildBreadcrumb,
  collectTouchedFilesFromChatLog,
} from '../../../../../../core/context/breadcrumb';
import { buildLlmBreadcrumbSummary } from '../../../../../../core/context/breadcrumbSummary';
import {
  clearExecutionLogger,
  flushExecutionLogger,
  getExecutionLogger,
} from '../../../../../../core/utils/executionLogger';

interface DesignBreadcrumbOptions {
  forceEmit?: boolean;
  summaryOverride?: string;
}

/**
 * Append a breadcrumb for a completed design job (§12).
 *
 * Design's learn phase emits a breadcrumb so the produced documents
 * appear as anchor pointers in the next resolve cycle. The auto
 * boundary previously paired with this BC was retired by
 * job-context-bridge T2 — only Hard Reset still cuts the timeline, and
 * that is recorded directly by SessionPersistence, not here.
 *
 * SSOT for touched files: chat.jsonl `chat_status` lines with
 * statusType in {file_create, file_edit, file_delete} (+ failed
 * variants) — see core/context/breadcrumb.ts
 * `collectTouchedFilesFromChatLog`. `state.files` is consulted as a
 * fallback when the chat log is empty (e.g. docGen wrote via non-tool
 * paths).
 */
async function applyDesignBreadcrumbBoundary(
  state: DesignGraphState,
  options: DesignBreadcrumbOptions = {},
): Promise<void> {
  const session = state.deps?.session;
  if (!session) return;
  const jobId = state.jobId;
  const turnId = state.turnId;
  if (!jobId || !turnId) {
    console.warn('⚠️  [Design Learn] skip breadcrumb/boundary (missing turnId)');
    return;
  }
  const touched = await collectTouchedFilesFromChatLog(session, turnId);
  let pathsFromTrace = Array.from(touched.all);
  let created = touched.created;
  let modified = touched.modified;
  let deleted = touched.deleted;
  let rangeRef = touched.range;
  if (pathsFromTrace.length === 0) {
    // Fallback — docGen nodes may write via non-tool paths so chat.jsonl
    // can be empty even when state.files captured newly produced docs.
    // Reconstruct the created / modified / deleted stats from each file's
    // `actionType` so the breadcrumb accurately reflects what happened
    // instead of reporting zero mutations for every category.
    const fbCreated: string[] = [];
    const fbModified: string[] = [];
    const fbDeleted: string[] = [];
    for (const f of state.files || []) {
      const p = typeof (f as any)?.path === 'string' ? (f as any).path : undefined;
      if (!p) continue;
      switch ((f as any).actionType) {
        case 'edit':
        case 'append':
          fbModified.push(p);
          break;
        case 'delete':
          fbDeleted.push(p);
          break;
        case 'create':
        default:
          fbCreated.push(p);
      }
    }
    const fbDeleteExtra = Array.isArray((state as any).filesToDelete)
      ? ((state as any).filesToDelete as string[]).filter((p) => typeof p === 'string' && p.length > 0)
      : [];
    for (const p of fbDeleteExtra) {
      if (!fbDeleted.includes(p)) fbDeleted.push(p);
    }
    pathsFromTrace = [...fbCreated, ...fbModified, ...fbDeleted];
    created = fbCreated;
    modified = fbModified;
    deleted = fbDeleted;
    rangeRef = undefined;
  }
  const mode = state.resolvedAction?.mode;
  // Skip explain mode — no anchor information to record (job-context-bridge T3).
  if (mode === 'explain' && options.forceEmit !== true) {
    console.log("📝 [Design Learn] breadcrumb skipped: mode='explain' (no anchors)");
    return;
  }
  if (pathsFromTrace.length === 0 && options.forceEmit !== true) {
    console.log('📝 [Design Learn] breadcrumb skipped: touched=0 (no doc change)');
    return;
  }

  // job-context-bridge T4 — LLM-generated noun-form summary; falls back to
  // directive paraphrase on any failure.
  const summary =
    typeof options.summaryOverride === 'string' && options.summaryOverride.trim().length > 0
      ? options.summaryOverride.trim()
      : await buildLlmBreadcrumbSummary({
          directive: state.directive || '',
          mode,
          created,
          modified,
          deleted,
          touchedCount: pathsFromTrace.length,
          llm: state.deps?.llm,
          promptPort: state.deps?.promptBuilder,
        });

  const breadcrumb = buildBreadcrumb({
    jobId,
    turnId,
    jobType: 'design',
    mode,
    touched: pathsFromTrace,
    created,
    modified,
    deleted,
    summary,
    traceRangeRef: rangeRef,
  });
  try {
    await session.appendBreadcrumb(breadcrumb);
    console.log(
      `📝 [Design Learn] breadcrumb appended (scope=${breadcrumb.scope} touched=${pathsFromTrace.length})`,
    );
  } catch (err) {
    console.warn('⚠️  [Design Learn] appendBreadcrumb failed:', err);
  }

  // job-context-bridge T2 — auto boundary deprecated for design too.
  // Hard Reset is recorded by SessionPersistence; nothing to do here.
}

function buildDesignFailureBreadcrumbSummary(state: DesignGraphState): string | undefined {
  if (!state.designError && !state.interruption?.reason) return undefined;
  const mode = state.resolvedAction?.mode ?? 'generate';
  const reason = state.designError ? 'design_error' : state.interruption?.reason ?? 'design_failed';
  const detail = state.designError?.message || state.interruption?.message || 'design job ended before completion';
  const normalizedDetail =
    detail.length > 180 ? `${detail.slice(0, 177)}...` : detail;
  return `failure: ${reason} · ${mode} · ${normalizedDetail}`;
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
    
    const isUiDesign = state.resolvedAction?.intentGroup === 'design-ui'
      || state.resolvedAction?.intent === 'gen-ui-figma'
      || state.resolvedAction?.intent === 'gen-ui-desc'
      || state.resolvedAction?.intent === 'rev-ui';
    const isSpecDesign = state.resolvedAction?.intentGroup === 'design-spec';

    // Canonical destination: UI → visual/ui/ant, Spec → architecture/spec,
    // System → architecture/system. Single directory per intent (no fallback).
    const targetDirRelToFeature = isUiDesign
      ? ARTIFACT_PREFIX.UI_ANT.replace(/\/$/, '')
      : isSpecDesign
        ? ARTIFACT_PREFIX.SPEC.replace(/\/$/, '')
        : ARTIFACT_PREFIX.SYSTEM_DESIGN.replace(/\/$/, '');
    const subDirRel = path.join(featureDirRel, targetDirRelToFeature);
    const label = isUiDesign ? 'UI Design' : isSpecDesign ? 'Spec Design' : 'System Design';
    console.log(`📂 [Learn] Checking ${label} files in ${targetDirRelToFeature}/...`);

    try {
      const filesToProcess: { filename: string; dir: string }[] = [];

      if (await fileSystem.fileExists(subDirRel)) {
        const entries = await fileSystem.readDirectory(subDirRel);

        if (isUiDesign) {
          const expectedFiles = ['ui-tokens.json', 'ui-assets.json', 'ui-spec.json'];
          for (const e of entries) {
            if (!e.isDirectory && expectedFiles.includes(e.name)) {
              filesToProcess.push({ filename: e.name, dir: subDirRel });
            }
          }
        } else {
          for (const e of entries) {
            if (!e.isDirectory && e.name.endsWith('.md')) {
              filesToProcess.push({ filename: e.name, dir: subDirRel });
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

        const relativePath = `${targetDirRelToFeature}/${filename}`;

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
      `No design files found under architecture/{system,spec}/ or visual/ui/ant/ — docGen nodes must have run`
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

  // Session redesign §2.4 — design breadcrumb append.
  //
  // Unified failure policy with code job:
  //   - success: original gates (`mode='explain'`, touched=0) stay intact
  //   - failure/interruption: force-emit a failure summary BC so the next
  //     turn can observe why this run stopped, even when touched=0.
  if (isLastTask && !_isWorkerContext && state.deps?.session) {
    try {
      await applyDesignBreadcrumbBoundary(state, {
        forceEmit: hasEarlyTermination,
        summaryOverride: hasEarlyTermination
          ? buildDesignFailureBreadcrumbSummary(state)
          : undefined,
      });
    } catch (err) {
      console.warn('⚠️  [Design Learn] breadcrumb write failed:', err);
    }
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
    await flushExecutionLogger(state._httpJobId);
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
      
      // Resolve the spec filename in basename form. design-spec intents
      // write under `architecture/spec/<name>.md`; we strip the directory
      // segments so the FE choice card shows the bare filename. Use
      // `path.basename` so the new domain-rooted tree (`architecture/`,
      // `visual/`) is handled uniformly without per-prefix branches.
      const firstPath = state.files?.[0]?.path;
      const specFile = state.completedTasksDetails?.[0]?.targetFile
        || (firstPath ? path.basename(firstPath) : undefined)
        || 'spec.md';
      
      const isKo = state._uiLocale === 'ko' || state._uiLocale !== 'en';
      
      // Carry the data the FE needs to start the code job through the
      // explicit pipeline (no LLM detect re-interpretation of the
      // "Implement <specFile>" directive). `specPath` pins the spec as
      // a ref, `sourceFiles` becomes the explicit context (PRD / GDD /
      // user-uploaded originals), and `domain` keeps the resolved
      // domain stable across the design→code hand-off.
      const sourceFiles = state.workspaceState?.planFileNames ?? [];
      const racDomain = state.resolvedAction?.domain;

      await chatAPI.sendChoiceCard({
        type: 'spec_complete',
        title: isKo ? '스펙 작성 완료' : 'Spec Complete',
        choices: [
          {
            id: 'develop',
            label: isKo ? '바로 개발 시작' : 'Start Development',
            action: 'redirect',
            data: {
              targetJob: 'code',
              specFile,
              specPath: `${ARTIFACT_PREFIX.SPEC}${specFile}`,
              sourceFiles,
              ...(racDomain ? { domain: racDomain } : {}),
            },
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
