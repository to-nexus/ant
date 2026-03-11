/**
 * CodeGen Node - 코드 생성 추론 (순수 LLM 추론)
 * 
 * 책임:
 * - LLM 호출 및 스트리밍
 * - Thinking/Text 수집
 * - Tool Call 감지 (실행은 하지 않음!)
 * 
 * 하지 않는 것:
 * - Tool 실행
 * - 파일 쓰기
 * - 루프 (LangGraph가 관리)
 * 
 * ✅ MODULAR ARCHITECTURE:
 * - promptBuilder.ts: Message & context building
 * - toolDefinitions.ts: Available tools
 * - referenceFilter.ts: Reference context filtering
 */

import path from 'node:path';
import { ArchitectGraphState } from '../../state';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';

// Import submodules
import { buildMessages } from './promptBuilder';
import { getAvailableTools } from './toolDefinitions';
import { ArtifactService } from '../../../../../../infrastructure/workspace/ArtifactService';
import { normalizeToCodebasePath } from '../../../../../../core/utils/pathNormalizer';
import { cleanFileContentFromResponse, cleanFileContentWithConflicts } from '../../utils/responseCleaners';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import { isFinalVerificationTask } from '../../utils/taskClassification';

export async function codeGen(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n💭 [CodeGen] Starting reasoning...\n');
  
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llmClient = state.deps?.llm;
  if (!llmClient) {
    throw new Error('LLM client not available');
  }
  
  // ✅ NEW: Use codeGen-specific model if configured
  let llmToUse = llmClient;
  if (state.workspaceConfig) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
    
    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', nodeType: 'codeGen' },
      state.workspaceConfig
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Guardrail: UI task requires UI-doc injection contract
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Principle:
  // - If the task is explicitly marked UI (from decompose), then the UI docs must be available for injection.
  // - If UI docs EXIST in inputs/sources but are missing/unloaded, we must FAIL FAST to avoid silent drift.
  // - If UI docs truly do NOT exist for this feature, do NOT fail: proceed with defaults derived from PRD/design.
  // - Use the existing self-healing path: fileErrors → checkTaskStatus → enforce → plan.
  if (state.currentTask?.ui === true) {
    const path = await import('path');

    const fileSystemRoot = state.deps?.fileSystem?.getRootPath?.();
    const featurePathAbs = state.context.featurePath;
    const featurePathRel = (() => {
      if (!featurePathAbs) return undefined;
      if (fileSystemRoot && typeof fileSystemRoot === 'string') {
        return path.relative(fileSystemRoot, featurePathAbs);
      }
      // Worst-case: assume FileSystemPort root already equals featurePathAbs parent (cloud project root)
      return featurePathAbs.startsWith('/') ? featurePathAbs.slice(1) : featurePathAbs;
    })();

    // Detect whether UI docs exist (canonical only: inputs/sources/*).
    // This distinguishes:
    // - "Docs truly absent" (allowed)
    // - "Docs present but not injected/loaded" (bug; fail fast)
    const uiDocsExist = await (async () => {
      const fsPort = state.deps?.fileSystem as any;
      if (!fsPort || !featurePathRel) return false;
      const candidates = [
        'ui-spec.json',
        'ui-assets.json',
        'ui-tokens.json',
      ].map(name => path.join(featurePathRel, 'inputs', 'sources', name));
      for (const p of candidates) {
        try {
          if (await fsPort.fileExists(p)) return true;
        } catch {
          // ignore
        }
      }
      return false;
    })();

    // Best-effort: (re)load parsedUiDocs once, in case state was restored without it or inputs changed.
    // NOTE: This mutates state directly, which is an anti-pattern in LangGraph, but necessary here
    // because promptBuilder needs access to parsedUiDocs immediately. The proper fix would be
    // to pass parsedUiDocs as a separate parameter to buildMessages.
    if (!state.parsedUiDocs && state.deps?.git && state.deps?.fileSystem) {
      try {
        const parsed = await ArtifactService.loadParsedUiContext(state.context, state.deps.git, state.deps.fileSystem);
        if (parsed) {
          // Channel is now defined in graph.ts, so direct assignment is type-safe
          state.parsedUiDocs = parsed;
        }
      } catch {
        // ignore (we'll fail below if still missing)
      }
    }

    if (uiDocsExist && !state.parsedUiDocs) {
      const msg =
        `UI task requires UI specification docs to be loaded and injected, but none were available.\n` +
        `Docs appear to exist under inputs/sources, but UI-doc injection did not occur.\n` +
        `This would cause implementation drift (e.g., placeholders instead of mapped assets).\n` +
        `Fix: ensure inputs/sources documents are user-filled (not templates/comments-only) and that featurePath/workspace resolution is correct, then retry.`;
      return {
        ...state,
        fileErrors: [msg],
        llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] }
      };
    }
  }

  // ✅ Collect other tasks' files for Session File Manifest (cross-task awareness)
  // In parallel mode, SharedFileBuffer tracks all files written by all workers.
  // We use getWrittenByOtherTasks (taskName-based) instead of getWrittenFilesByOtherWorkers
  // (workerId-based) so that a feature task on Worker 0 can see foundation files also
  // written by Worker 0 in an earlier task (same-worker blind spot fix).
  const currentTaskName = state.currentTask?.name ?? '';
  const workerFSForManifest = state.deps?.fileSystem as any;
  if (workerFSForManifest?.sharedBuffer?.getWrittenByOtherTasks) {
    const otherTaskFiles: Array<{ path: string; taskName?: string }> =
      workerFSForManifest.sharedBuffer.getWrittenByOtherTasks(currentTaskName);
    if (otherTaskFiles.length > 0) {
      (state as any)._otherWorkerFiles = otherTaskFiles;
      console.log(`📋 [CodeGen] Session manifest: ${otherTaskFiles.length} file(s) from other tasks`);
    }
  } else if (workerFSForManifest?.sharedBuffer?.getWrittenFilesByOtherWorkers) {
    const currentWorkerId = (state as any).workerId ?? 0;
    const otherWorkerFiles: Array<{ path: string; taskName?: string }> =
      workerFSForManifest.sharedBuffer.getWrittenFilesByOtherWorkers(currentWorkerId);
    if (otherWorkerFiles.length > 0) {
      (state as any)._otherWorkerFiles = otherWorkerFiles;
      console.log(`📋 [CodeGen] Session manifest: ${otherWorkerFiles.length} file(s) from other workers (legacy fallback)`);
    }
  }

  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ Progressive call budget warning injection (mirrors design job docGen pattern)
  // LLM must know its remaining budget to prioritize file output over analysis.
  {
    const currentCall = (state._codeGenCallIndex || 0) + 1;
    const isVerifyType = state.currentTask?.type === 'verification';
    const isErrorType = state.currentTask?.type === 'error';
    const isFinalType = state.currentTask ? isFinalVerificationTask(state.currentTask) : false;
    const maxCalls = isVerifyType ? 22 : (isFinalType || isErrorType) ? 0 : 20;
    
    if (maxCalls > 0 && currentCall >= 3) {
      const remaining = maxCalls - currentCall;
      let budgetWarning: string;
      if (remaining <= 2) {
        budgetWarning = `\n\n⚠️ SYSTEM WARNING [call budget: ${currentCall}/${maxCalls}, ${remaining} remaining]\n` +
          `You MUST output all remaining files NOW using <file> tags and then <done>true</done>, or this task will be TERMINATED as FAILED. ` +
          `Use the information already gathered. Do NOT read more files.`;
      } else if (remaining <= 5) {
        budgetWarning = `\n\n⚠️ WARNING [call budget: ${currentCall}/${maxCalls}]\n` +
          `You MUST start writing files NOW. Output <file> tags for implementation, then <done>true</done>. You have ${remaining} calls remaining.`;
      } else {
        budgetWarning = `\n\n[call budget: ${currentCall}/${maxCalls}]\n` +
          `You have ${remaining} calls remaining. Start producing file output soon.`;
      }
      
      // Inject into last user message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user') {
          if (Array.isArray(msg.content)) {
            (msg.content as any[]).push({ type: 'text', text: budgetWarning });
          } else if (typeof msg.content === 'string') {
            msg.content = [
              { type: 'text', text: msg.content },
              { type: 'text', text: budgetWarning },
            ];
          }
          break;
        }
      }
      
      const level = remaining <= 2 ? 'URGENT' : remaining <= 5 ? 'WARNING' : 'INFO';
      console.log(`⚠️  [CodeGen] Budget ${level}: call ${currentCall}/${maxCalls}, ${remaining} remaining`);
    }
  }
  
  // ✅ Tool activation control
  // - Explain mode: NO tools (just explanation)
  // - All other modes in code graph: YES tools (generate/refactor/unknown)
  // 
  // ⚠️ DEFENSIVE: Default to tools ENABLED in code graph.
  // Previously, tools were disabled when detectionReport.jobMode was undefined,
  // causing LLM to output <function_calls><invoke> XML as text instead of
  // using structured tool_use blocks. This happened when detectionReport was
  // not properly restored on resume.
  const isExplainMode = state.detectionReport?.jobMode === 'explain';
  const enableTools = !isExplainMode;
  const tools = enableTools ? await getAvailableTools(state) : undefined;
  
  if (!state.detectionReport?.jobMode) {
    console.warn(`⚠️ [CodeGen] detectionReport.jobMode is missing — defaulting to tools enabled`);
  }
  
  if (isExplainMode) {
    console.log(`💡 [CodeGen] Explain mode - tools disabled (explanation only)`);
  } else {
    console.log(`🔧 [CodeGen] Tool calling enabled (code job, mode=${state.detectionReport?.jobMode || 'unknown'})`);
  }
  
  // ✅ Workflow update
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
      'codeGen',  // ✅ FIX: Must match graph.addNode() name!
      (state as any).workerId ?? 0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ UI streaming
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Code jobs must write into repoRoot (codebase directory)
  const repoRootForWrites = state.deps?.git ? await state.deps.git.getRepoRoot() : undefined;

  // ✅ Setup XML Parser + StreamOrchestrator for MD file streaming
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git,  // ✅ Pass gitPort for actual file editing
    state.deps?.fileSystem,  // ✅ Pass fileSystem for file operations
    true,  // ✅ writeImmediately: true for code job (no separate writeFiles node)
    'code',  // ✅ jobType: 'code' (no LAST_SECTION handling needed)
    undefined,  // ✅ Code job: no featurePath
    repoRootForWrites,  // ✅ Code job: write files under repoRoot (codebase)
    state.deps?.fileTreeUpdate  // ✅ For real-time file tree updates via Redis Pub/Sub
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');
  
  // ✅ Code job: Build existingFiles from projectCodeContext + referenceCodeContexts
  // These contain the actual codebase files loaded by the plan node
  // This prevents LLM from accidentally using <file> on existing files
  //
  // CRITICAL: All paths are normalized via normalizeToCodebasePath to ensure
  // consistent path format between what was written (FileRenderer) and what
  // is looked up (FileRegistry.isExisting). Without normalization, paths like
  // "src/application/x" and "codebase/src/application/x" would be treated as different.
  const existingFiles = new Set<string>();
  
  // ✅ Compute codebaseRel for consistent normalization
  const codebaseRel = (() => {
    if (!repoRootForWrites || !state.deps?.fileSystem) return 'codebase';
    const wsRoot = state.deps.fileSystem.getRootPath?.();
    if (!wsRoot) return 'codebase';
    return path.relative(wsRoot, repoRootForWrites).replace(/\\/g, '/') || 'codebase';
  })();
  
  // ✅ CRITICAL: Use filePaths instead of files array
  // - files array may be empty (content not saved to session for memory optimization)
  // - filePaths array always contains the list of known files
  if (state.projectCodeContext?.filePaths) {
    for (const filePath of state.projectCodeContext.filePaths) {
      if (filePath) {
        // Normalize to ensure consistent format in the Set
        const { normalized } = normalizeToCodebasePath(filePath, codebaseRel);
        existingFiles.add(normalized);
      }
    }
  }
  
  // ✅ FALLBACK: Also add files from files array if available
  if (state.projectCodeContext?.files) {
    for (const file of state.projectCodeContext.files) {
      if (file.path) {
        const { normalized } = normalizeToCodebasePath(file.path, codebaseRel);
        existingFiles.add(normalized);
      }
    }
  }
  
  console.log(`📊 [CodeGen] existingFiles from projectCodeContext: filePaths=${state.projectCodeContext?.filePaths?.length ?? 0}, files=${state.projectCodeContext?.files?.length ?? 0}, existingFilesSet=${existingFiles.size}`);

  // Add files from referenceCodeContexts
  if (state.referenceCodeContexts) {
    for (const refContext of state.referenceCodeContexts) {
      if (refContext?.files) {
        for (const file of refContext.files) {
          if (file.path) {
            const { normalized } = normalizeToCodebasePath(file.path, codebaseRel);
            existingFiles.add(normalized);
          }
        }
      }
    }
  }
  
  // ✅ Cross-worker awareness: Track other workers' files SEPARATELY
  // These paths are added to existingFiles (for LLM prompt context — "this file exists")
  // but also tracked in otherWorkerPaths so FileRegistry.isKnownAtStart() returns false
  // for them. This forces the writeNewFile() path in FileRenderer, triggering
  // SharedFileBuffer's ownership check instead of a silent overwrite.
  const otherWorkerPaths = new Set<string>();
  const workerFS = state.deps?.fileSystem as any;
  if (workerFS?.sharedBuffer && typeof workerFS.sharedBuffer.getAllWrittenPaths === 'function') {
    const sharedPaths: string[] = workerFS.sharedBuffer.getAllWrittenPaths();
    for (const p of sharedPaths) {
      existingFiles.add(p);
      otherWorkerPaths.add(p);
    }
    if (sharedPaths.length > 0) {
      console.log(`📁 [CodeGen] Added ${sharedPaths.length} path(s) from SharedFileBuffer (${otherWorkerPaths.size} as otherWorkerPaths)`);
    }
  }
  
  // existingFiles Set initialized (prevents duplicate file creation)
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
    codebaseRel,  // ✅ Pass to FileRegistry for consistent path normalization
    otherWorkerPaths,  // ✅ Other workers' paths — forces writeNewFile() path for conflict detection
  });
  
  // Collect LLM output
  let thinking = '';
  let thinkingSignature = '';
  let textResponse = '';
  let isDone = false;  // ✅ Track done event (don't propagate immediately)
  let newCallIndex = (state._codeGenCallIndex || 0) + 1;
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  // ✅ Check if this is a continuation after tool calling
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  
  // ✅ Track token usage for this LLM call
  let capturedUsage: any = undefined;
  
  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmToUse.stream(messages, {
      tools,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: !isAfterToolCall,
      thinkingBudget: LLM_THINKING_BUDGET.CODE_EXECUTE,
    })) {
      if (event.type === 'retry') {
        thinking = '';
        thinkingSignature = '';
        textResponse = '';
        isDone = false;
        toolCalls.length = 0;
        capturedUsage = undefined;
        continue;
      }
      
      await orchestrator.processEvent(event);
      
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
        if (event.signature) {
          thinkingSignature = event.signature;
        }
      }
      
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        await chatAPI.sendLLMEvent(event);
        
        toolCalls.push({ id, name, args: input });
      }
      
      if (event.type === 'done') {
        isDone = true;
        
        // ✅ Extract token usage and accumulate to task-level
        const { extractTokenUsageFromStreamEvent, accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
          updateKanbanTokenUsage(state as any);

          // Log to debug/tokens/ for per-call analysis
          const callIdx = newCallIndex - 1;
          const taskUsage = state._currentTaskTokenUsage;
          logTokenUsageToFile(
            state.context?.featurePath,
            state._httpJobId,
            capturedUsage,
            {
              taskId: state.currentTask?.id || 'unknown',
              taskName: state.currentTask?.name || 'unknown',
              node: 'codeGen',
              callIndex: callIdx,
              conversationHistoryLength: state.conversationHistory?.length || 0,
              projectCodeContextFiles: state.projectCodeContext?.files?.length || 0,
              estimatedPromptChars: 0,
              taskCumulativeInput: (taskUsage?.inputTokens || 0) - (capturedUsage.inputTokens || 0),
              taskCumulativeOutput: (taskUsage?.outputTokens || 0) - (capturedUsage.outputTokens || 0),
              recursionCount: state.recursionCount,
            }
          );
        }
      }
    }
    
    // Wait for all file operations to complete BEFORE finalizing
    try {
      await orchestrator.waitForAllFileOperations();
    } catch (fileError) {
      // Do NOT throw! Let validation handle it
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      console.error(`⚠️ [CodeGen] File operation failed: ${errorMsg}`);
    }
    
    // Propagate done event (files are guaranteed to be saved OR errors recorded)
    if (isDone) {
      await chatAPI.sendLLMEvent({ type: 'done' });
    }
    
    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);
    
    // ✅ CRITICAL: Extract file errors from finalize result for self-healing
    const fileErrors = finalizeResult.fileErrors || [];
    if (fileErrors.length > 0) {
      console.error(`⚠️  [CodeGen] ${fileErrors.length} file error(s) detected for self-healing`);
      for (const error of fileErrors) {
        console.error(`   - ${error}`);
      }
    }

    // ✅ Reliable projectCodeContext update from streamedFiles.
    // streamedFiles always contains written file paths regardless of registry state.
    // Used as the base for ALL return paths (conflict, tool-call, no-done, normal)
    // to guarantee filePaths propagation to the next codeGen turn.
    const earlyStreamedPaths = (finalizeResult?.streamedFiles || [])
      .map((fp: string) => normalizeToCodebasePath(fp, codebaseRel).normalized);
    let earlyUpdatedProjectCodeContext = state.projectCodeContext;
    if (earlyStreamedPaths.length > 0) {
      const prevPaths = state.projectCodeContext?.filePaths || [];
      const merged = Array.from(new Set([...prevPaths, ...earlyStreamedPaths]));
      earlyUpdatedProjectCodeContext = state.projectCodeContext
        ? { ...state.projectCodeContext, filePaths: merged }
        : { source: 'codeGen' as const, filePaths: merged, files: [], stats: { filesLoaded: merged.length, estimatedTokens: 0 } };

      if (state._verificationTracker) {
        state._verificationTracker.buildPassed = false;
        state._verificationTracker.testPassed = false;
      }
    }

    // ✅ DIRECT MERGE: Handle cross-worker file conflicts without enforce/plan/read_file
    // Instead of: codeGen → checkTaskStatus → enforce → plan → codeGen → read_file → tool → codeGen (4-5 LLM calls)
    // Optimized:  codeGen → codeGen with merge instruction (1 LLM call)
    const fileConflicts = finalizeResult.fileConflicts || [];
    if (fileConflicts.length > 0) {
      console.log(`🔀 [CodeGen] ${fileConflicts.length} cross-worker conflict(s) — injecting direct merge instruction`);

      // 1. Authorize worker for post-merge writes (prevents re-conflict on next write)
      const workerFSForAuth = state.deps?.fileSystem as any;
      const currentWorkerId = (state as any).workerId ?? 0;
      if (workerFSForAuth?.sharedBuffer?.authorizeWriter) {
        for (const conflict of fileConflicts) {
          workerFSForAuth.sharedBuffer.authorizeWriter(conflict.path, currentWorkerId);
          console.log(`   🔑 Authorized worker ${currentWorkerId} for merge-write: ${conflict.path}`);
        }
      }

      // 2. Build merge instruction — smart diff to reduce token usage
      // Full file contents for both versions can be 50-100K+ tokens.
      // Instead, show only the differing sections with context.
      const mergeBlocks = fileConflicts.map(c => {
        const ownerInfo = c.ownerTask ? ` (by task "${c.ownerTask}")` : '';
        const currentLines = (c.currentContent || '').split('\n');
        const intendedLines = (c.intendedContent || '').split('\n');

        // For small files (< 150 lines each), inline full content is acceptable
        if (currentLines.length < 150 && intendedLines.length < 150) {
          return [
            `### FILE MERGE: ${c.path}`,
            `This file was already created by another parallel task${ownerInfo}.`,
            ``,
            `CURRENT content (from other task):`,
            '```',
            c.currentContent,
            '```',
            ``,
            `YOUR intended content:`,
            '```',
            c.intendedContent,
            '```',
            ``,
            `Output the MERGED result as <file path="${c.path}">merged content</file>.`,
            `Do NOT call read_file — you already have both versions above.`,
          ].join('\n');
        }

        // For large files: show CURRENT in full (it's the on-disk version the LLM
        // hasn't seen), and only the differing regions of YOUR intended version
        // (the LLM wrote this content earlier, so shared sections are redundant).
        const CONTEXT = 5;
        const diffRegions: string[] = [];
        const maxLen = Math.max(currentLines.length, intendedLines.length);
        let regionStart = -1;

        for (let i = 0; i <= maxLen; i++) {
          const same = i < maxLen && i < currentLines.length && i < intendedLines.length
            && currentLines[i] === intendedLines[i];
          if (!same && regionStart === -1) {
            regionStart = i;
          }
          if ((same || i === maxLen) && regionStart !== -1) {
            const from = Math.max(0, regionStart - CONTEXT);
            const to = Math.min(maxLen, i + CONTEXT);
            diffRegions.push(
              `--- YOUR intended lines ${from + 1}-${to} ---\n` +
              intendedLines.slice(from, Math.min(to, intendedLines.length)).map((l, idx) => `${from + idx + 1}| ${l}`).join('\n')
            );
            regionStart = -1;
          }
        }

        return [
          `### FILE MERGE: ${c.path}`,
          `This file was already created by another parallel task${ownerInfo}.`,
          ``,
          `CURRENT content on disk (${currentLines.length} lines, from other task — FULL):`,
          '```',
          c.currentContent,
          '```',
          ``,
          `YOUR intended changes (only differing sections from your ${intendedLines.length}-line version):`,
          ``,
          diffRegions.join('\n\n'),
          ``,
          `Merge: start from the CURRENT content above, then apply YOUR intended changes into it.`,
          `Output the MERGED result as <file path="${c.path}">merged content</file>.`,
          `Do NOT call read_file — you have the full current version and your changes above.`,
        ].join('\n');
      }).join('\n\n---\n\n');

      const mergeInstruction = [
        `FILE MERGE REQUIRED — ${fileConflicts.length} file(s) need merging.`,
        ``,
        mergeBlocks,
        ``,
        `After outputting all merged files, output <done>true</done>. Files marked [file written to disk: ...] are already saved — do NOT regenerate them.`,
      ].join('\n');

      // 3. Inject into conversation and loop back (no enforce/plan needed)
      // Distinguish conflict vs successfully-written files so LLM doesn't regenerate everything
      const conflictPaths = new Set(fileConflicts.map(c => c.path));
      const cleanedResponse = cleanFileContentWithConflicts(textResponse, conflictPaths);

      const newHistory = [
        ...(state.conversationHistory || []),
        ...(cleanedResponse ? [{ role: 'assistant' as const, content: cleanedResponse }] : []),
        { role: 'user' as const, content: mergeInstruction },
      ];

      // Workflow exit
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen', (state as any).workerId ?? 0);
      }

      // Suppress fileErrors while merge is in progress — returning them
      // would cause codeGenRouter to route to checkTaskStatus, losing the
      // merge instruction injected above.  Any genuine non-conflict errors
      // will resurface after the LLM processes the merge.
      if (fileErrors.length > 0) {
        console.log(`   🔇 [CodeGen] Suppressing ${fileErrors.length} fileError(s) during merge — will resurface after merge completes`);
      }

      return {
        llmResponse: {
          thinking,
          thinkingSignature: thinkingSignature || undefined,
          textResponse,
          toolCalls,
          done: false,
          tokenUsage: capturedUsage,
        },
        conversationHistory: newHistory,
        fileErrors: undefined,
        projectCodeContext: earlyUpdatedProjectCodeContext,
        _codeGenCallIndex: newCallIndex,
        _finalTaskLoopCount: 0,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
        profile: state.profile,
      };
    }
    
    // ✅ CRITICAL: Extract files from FileRegistry for state.files
    const files: Array<{ path: string; content: string; actionType: 'create' | 'edit' | 'append' | 'delete' }> = [];
    if (finalizeResult?.streamedFiles) {
      for (const filePath of finalizeResult.streamedFiles) {
        // Try to get file info from registry (has actionType)
        const fileInfo = (orchestrator as any).registry?.getFileInfo?.(filePath);
        if (fileInfo) {
          files.push({
            path: filePath,
            content: fileInfo.contentBuffer || '',
            actionType: fileInfo.actionType as any
          });
        }
      }
    }
    // Finalize chat message if no tool calls (task/reasoning complete)
    if (toolCalls.length === 0) {
      const chatAPI = getChatAPIClient();
      await chatAPI.finalizeMessage();
    }
    
    console.log(`✅ [CodeGen] Complete: ${toolCalls.length} tools, ${files.length} files${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);

    
    // ✅ Explain mode validation
    if (isExplainMode && toolCalls.length > 0) {
      console.error('⚠️  [CodeGen] Explain mode should NOT use tools!');
      console.error('   Tool calls detected:', toolCalls.map(t => t.name).join(', '));
      throw new Error('[CodeGen] Explain mode should not generate tool calls. Response must be pure text explanation.');
    }
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen', (state as any).workerId ?? 0);
    }
    
    // ✅ Return LLM response (state에 저장)
    
    // ✅ CRITICAL: Accumulate created/modified files to projectCodeContext
    // Uses earlyUpdatedProjectCodeContext (from finalizeResult.streamedFiles) as the
    // reliable base. The `files` array from registry.getFileInfo may be empty when
    // the registry loses content tracking, but streamedFiles always has the paths.
    // Without this, existingFiles Set is empty on each turn, causing:
    // - Duplicate file creation (same files recreated 3-4 times in setup tasks)
    // - generateFileTree returning null (LLM doesn't see existing files)
    const newFilePaths = files
      .filter(f => f.actionType === 'create' || f.actionType === 'edit')
      .map(f => normalizeToCodebasePath(f.path, codebaseRel).normalized);
    
    let updatedProjectCodeContext = earlyUpdatedProjectCodeContext;
    
    if (newFilePaths.length > 0) {
      const existingPaths = earlyUpdatedProjectCodeContext?.filePaths || [];
      const combinedPaths = Array.from(new Set([...existingPaths, ...newFilePaths]));
      
      updatedProjectCodeContext = earlyUpdatedProjectCodeContext ? {
        ...earlyUpdatedProjectCodeContext,
        filePaths: combinedPaths
      } : {
        source: 'codeGen' as const,
        filePaths: combinedPaths,
        files: [],
        stats: { filesLoaded: combinedPaths.length, estimatedTokens: 0 }
      };
    }
    
    console.log(`📊 [CodeGen] projectCodeContext update: early=${earlyUpdatedProjectCodeContext?.filePaths?.length ?? 0}, registryFiles=${newFilePaths.length}, final=${updatedProjectCodeContext?.filePaths?.length ?? 0}`);

    // ✅ CRITICAL: Only mark done if LLM explicitly output <done>true</done>
    // Use explicitDone from streaming pipeline (detected by SpecialTagTransformer)
    // Previously: done = toolCalls.length === 0 (caused premature completion on truncated responses)
    const explicitDone = finalizeResult.explicitDone || false;

    // Safety Net: track final task loop count (MUST go through channel system via return)
    const isFinalTask = state.currentTask ? isFinalVerificationTask(state.currentTask) : false;
    const prevLoopCount = state._finalTaskLoopCount || 0;
    const isStuckLooping = isFinalTask && !explicitDone && toolCalls.length === 0;
    const newFinalTaskLoopCount = isStuckLooping ? prevLoopCount + 1 : 0;
    
    if (toolCalls.length === 0 && !explicitDone) {
      console.warn(`⚠️  [CodeGen] No tool calls and no <done>true</done> tag - LLM response may be incomplete`);
      
      // Preserve LLM response in conversationHistory to prevent amnesia.
      // Without this, codeGen→codeGen loop loses all memory of previous response,
      // causing the LLM to repeat the same work indefinitely.
      let cleanedResponse = cleanFileContentFromResponse(textResponse);
      
      // Defensive: if textResponse cleaning yields empty but files were streamed,
      // synthesize markers so the LLM knows which files exist on disk.
      const streamedFilePaths = finalizeResult?.streamedFiles || [];
      if (!cleanedResponse && streamedFilePaths.length > 0) {
        cleanedResponse = streamedFilePaths
          .map(fp => `[file written to disk: ${fp}]`)
          .join('\n');
      }
      
      if (cleanedResponse) {
        // Build re-entry message with specific file list so the LLM doesn't
        // have to search through history to find which files already exist.
        const reentryParts = [
          'Your previous response did not include <done>true</done>.',
        ];
        if (streamedFilePaths.length > 0) {
          reentryParts.push(
            '',
            `The following ${streamedFilePaths.length} file(s) are already saved to disk — do NOT recreate them:`,
            ...streamedFilePaths.map(fp => `  - ${fp}`),
          );
        }
        reentryParts.push(
          '',
          'If you have completed all work for this task, output <done>true</done> now.',
          'If there is remaining work, continue with NEW files only.',
        );

        const newHistory = [
          ...(state.conversationHistory || []),
          { role: 'assistant' as const, content: cleanedResponse },
          { role: 'user' as const, content: reentryParts.join('\n') },
        ];
        
        return {
          llmResponse: {
            thinking,
            thinkingSignature: thinkingSignature || undefined,
            textResponse,
            toolCalls,
            done: explicitDone,
            tokenUsage: capturedUsage,
          },
          conversationHistory: newHistory,
          fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
          projectCodeContext: updatedProjectCodeContext,
          _codeGenCallIndex: newCallIndex,
          _finalTaskLoopCount: newFinalTaskLoopCount,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          profile: state.profile,
        };
      }
    }
    
    return {
      llmResponse: {
        thinking,
        thinkingSignature: thinkingSignature || undefined,
        textResponse,
        toolCalls,
        done: explicitDone,
        tokenUsage: capturedUsage,
      },
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
      projectCodeContext: updatedProjectCodeContext,
      _codeGenCallIndex: newCallIndex,
      _finalTaskLoopCount: newFinalTaskLoopCount,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      profile: state.profile,
    };
  } catch (error) {
    console.error('[ERROR] ❌ [CodeGen] Error during reasoning:');
    console.error('[ERROR] Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('[ERROR] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[ERROR] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    if (error && typeof error === 'object') {
      console.error('[ERROR] Error details:', JSON.stringify(error, null, 2));
    }
    
    // ✅ Workflow instrumentation: Exit node (error path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen', (state as any).workerId ?? 0);
    }
    
    throw error;
  }
}

