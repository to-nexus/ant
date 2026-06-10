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
 * - buildMessages.ts: Message & context building (wraps core PromptBuilder)
 * - tools.ts: Available tools
 * - referenceFilter.ts: Reference context filtering
 */

import { ArchitectGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';

// Import submodules
import { buildMessages } from './buildMessages';
import { getTools } from './tools';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import { ArtifactService } from '../../../../../../infrastructure/workspace/ArtifactService';
import { normalizeToCodebasePath } from '../../../../../../core/utils/pathNormalizer';
import { resolveCodebaseRel } from './codebaseRel';
import { cleanFileContentFromResponse, cleanFileContentWithConflicts } from '../../utils/responseCleaners';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { buildMergeUserContent } from './mergeUserContent';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from '../../../../../common/graph/llmHelpers';
import { isVerificationTask } from '../../tasks/verification';
import { isUiTask } from '../../tasks/ui';
import { isErrorTask } from '../../tasks/error';
import type { CodeTask } from '../../../../types/task';

export async function execute(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n💭 [Execute] Starting reasoning...\n');

  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;

  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('execute', state.currentTask ?? undefined);

  const llmClient = state.deps?.llm;
  if (!llmClient) {
    throw new Error('LLM client not available');
  }
  
  // ✅ NEW: Use execute-specific model if configured
  let llmToUse = llmClient;
  if (state.workspaceConfig) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');

    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', nodeType: 'execute' },
      state.workspaceConfig
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Guardrail: UI task requires UI-doc injection contract
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI self-heal — gated by RAC UI slot.
  //
  // Pool SSOT (`AGENTS.md` "state.artifacts Post-RAC SSOT"): the pool is
  // the RAC subset. If `resolvedAction.refs ∪ context` does NOT carry a
  // `visual/ui/...` slot, the user did not opt into UI doc
  // injection — silently augmenting the pool here would re-introduce
  // exactly the leak the SSOT closes. When a UI slot IS present but the
  // ant subgroup is materially incomplete (file present on disk but not
  // yet in the pool — e.g. resume race), best-effort self-heal recovers
  // the missing entries.
  if (isUiTask(state.currentTask)) {
    const racPaths = [...(state.resolvedAction?.refs ?? []), ...(state.resolvedAction?.context ?? [])];
    const { ARTIFACT_PREFIX } = await import('@ant/shared');
    const racHasUiAntSlot = racPaths.some(p => p.startsWith(ARTIFACT_PREFIX.UI_ANT));
    if (racHasUiAntSlot) {
      const { ArtifactPoolView } = await import('../../../../../../core/prompt/builder/ArtifactPipeline');
      const { ARTIFACT_PREFIX: AP } = await import('@ant/shared');

      const poolView = new ArtifactPoolView(state.artifacts || []);
      if (!poolView.hasUi() && state.deps?.git && state.deps?.fileSystem) {
        try {
          const parsed = await ArtifactService.loadParsedUiContext(
            state.context,
            state.deps.git,
            state.deps.fileSystem,
          );
          if (parsed) {
            const uiPool: import('@ant/shared').ResolvedArtifact[] = [];
            if (parsed.tokens) uiPool.push({ path: `${AP.UI_ANT}tokens`, content: parsed.tokens, role: 'context' });
            if (parsed.assets) uiPool.push({ path: `${AP.UI_ANT}assets`, content: parsed.assets, role: 'context' });
            if (parsed.specSections) {
              for (const [id, section] of parsed.specSections) {
                if (section.content) uiPool.push({ path: `${AP.UI_ANT_SPEC}${id}`, content: section.content, role: 'context' });
              }
            }
            if (uiPool.length > 0) {
              state.artifacts = [...(state.artifacts || []), ...uiPool];
            }
          }
        } catch {
          // ignore
        }
      }
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
      state._otherWorkerFiles = otherTaskFiles;
      console.log(`📋 [CodeGen] Session manifest: ${otherTaskFiles.length} file(s) from other tasks`);
    }
  } else if (workerFSForManifest?.sharedBuffer?.getWrittenFilesByOtherWorkers) {
    const currentWorkerId = state.workerId ?? 0;
    const otherWorkerFiles: Array<{ path: string; taskName?: string }> =
      workerFSForManifest.sharedBuffer.getWrittenFilesByOtherWorkers(currentWorkerId);
    if (otherWorkerFiles.length > 0) {
      state._otherWorkerFiles = otherWorkerFiles;
      console.log(`📋 [CodeGen] Session manifest: ${otherWorkerFiles.length} file(s) from other workers (legacy fallback)`);
    }
  }

  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);

  // Tool activation: mode-aware selection is encapsulated in `./tools.ts`
  // (NODE_GRAPH_LAYOUT.md §2.2 — caller is a single `await getTools(state)` line).
  const isExplainMode = state.resolvedAction?.mode === 'explain';
  const tools = await getTools(state);
  
  if (!state.resolvedAction?.mode) {
    console.warn(`⚠️ [CodeGen] resolvedAction.mode is missing — defaulting to tools enabled`);
  }
  
  if (isExplainMode) {
    console.log(`💡 [CodeGen] Explain mode - read-only tools enabled`);
  } else {
    console.log(`🔧 [CodeGen] Tool calling enabled (code job, mode=${state.resolvedAction?.mode || 'unknown'})`);
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
      'execute',
      state.workerId ?? 0,
      taskInfo, 
      extractLLMInfo(llmToUse),
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
    state.deps?.fileTreeUpdate,  // ✅ For real-time file tree updates via Redis Pub/Sub
    // Per-task touched-files SSOT — mirrors the tool-handler path
    // (`ToolExecutionContext.recordFileTouch`) so `<file>` XML streaming
    // and `create_file`/`edit_file` tool calls converge on the same
    // `CodeTask.touchedFiles` array that checkTaskStatus then persists
    // into `code.json.state.completedTasksDetails[i]`.
    (filePath) => {
      if (!state.currentTask) return;
      const arr = (state.currentTask.touchedFiles ??= []);
      if (!arr.includes(filePath)) arr.push(filePath);
    },
    'execute',  // ✅ codePhase: execute — codebase/ writes allowed via the FileRenderer gate
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');
  
  // existingFiles guardrail: FileRegistry distinguishes overwrite vs new-create
  // at `<file>` tag emit time. Seed from a one-shot disk listing of `codebase/`
  // so sequential-mode runs still catch overwrites without SharedFileBuffer.
  // In parallel mode SharedFileBuffer appends cross-worker writes below.
  //
  // The same disk listing is captured into `_existingCodebaseFiles` so
  // `buildTaskInvariantContext` can surface a path manifest to the LLM.
  // This is the file-awareness channel that replaced the
  // `projectCodeContext` injection removed in commit cbb4d924 — guardrail
  // + prompt share one source of truth so they never drift.
  //
  // All paths are normalised via normalizeToCodebasePath to stay consistent
  // with what FileRenderer writes (`"src/app/x"` vs `"codebase/src/app/x"`).
  const existingFiles = new Set<string>();
  const existingCodebaseDiskFiles: string[] = [];

  const codebaseRel = await resolveCodebaseRel(state);

  const fileSystemForListing = state.deps?.fileSystem;
  if (fileSystemForListing) {
    try {
      const diskPaths = await fileSystemForListing.listFiles('codebase', [
        'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
        'coverage', '__pycache__', 'venv', '.venv', 'target',
        '*.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
      ]);
      for (const p of diskPaths) {
        const { normalized } = normalizeToCodebasePath(p, codebaseRel);
        existingFiles.add(normalized);
        existingCodebaseDiskFiles.push(normalized);
      }
    } catch (err) {
      console.warn(`⚠️  [CodeGen] listFiles('codebase') failed — existingFiles guardrail will rely on SharedFileBuffer only:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`📊 [CodeGen] existingFiles seeded from disk: ${existingFiles.size} path(s)`);

  // Publish the disk listing to state so `buildTaskInvariantContext` can
  // render the `Existing Codebase Files` manifest. Cross-worker writes are
  // surfaced separately via `_otherWorkerFiles` (populated upstream) and
  // must NOT be mixed in here.
  state._existingCodebaseFiles = existingCodebaseDiskFiles;


  // ✅ Cross-worker awareness: Track other workers' files SEPARATELY.
  // These paths are added to existingFiles so FileRegistry sees them as
  // pre-existing, but also tracked in otherWorkerPaths so
  // FileRegistry.isKnownAtStart() returns false for them. This forces the
  // writeNewFile() path in FileRenderer, triggering SharedFileBuffer's
  // ownership check instead of a silent overwrite. The LLM-facing manifest
  // for these paths is produced separately via `_otherWorkerFiles`.
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
  let newCallIndex = (state._executeCallIndex || 0) + 1;
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  const nodeExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  // ✅ Check if this is a continuation after tool calling
  const isAfterToolCall = nodeExecute.length > 0;
  
  // Remediation-style tasks (verification with its diagnostic plan,
  // error with its prePlanText) do not need extended thinking — the
  // plan is already concrete. Enabling thinking here produces
  // thinking-only responses (no tool calls), which the historical
  // Safety Net C killed; the net is retired but the rationale for
  // disabling thinking on remediation tasks stands.
  const isRemediationTask =
    isVerificationTask(state.currentTask) || isErrorTask(state.currentTask);
  const hasRemediationPlan = isRemediationTask && !!state.planText;

  // ✅ Track token usage for this LLM call
  let capturedUsage: any = undefined;

  // T1 pre-call estimate — centralised helper sums char-length over both
  // string and structured message content. Seeds the chat-input gauge
  // before the first `usage_partial` event arrives; overwritten (and
  // `estimating` flag cleared) by the first usage event from the LLM.
  applyEstimatedInputTokensFromMessages(state, messages);

  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmToUse.stream(messages, {
      tools,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: !isAfterToolCall && !hasRemediationPlan,
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

      // In-flight gauge update from usage_partial events (Anthropic/Gemini).
      // Overwrite-only; job/task counters are updated at 'done' below.
      maybeUpdatePhaseTokenUsage(state, event);

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
        const { extractTokenUsageFromStreamEvent, accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile, resolveModelIdSafe } = await import('../../../../../common/graph/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: true });
          updateKanbanTokenUsage(state);

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
              node: 'execute',
              callIndex: callIdx,
              modelId: resolveModelIdSafe(state),
              nodeHistoryLength: nodeExecute.length,
              estimatedPromptChars: 0,
              taskCumulativeInput: (taskUsage?.inputTokens || 0) - (capturedUsage.inputTokens || 0),
              taskCumulativeOutput: (taskUsage?.outputTokens || 0) - (capturedUsage.outputTokens || 0),
              recursionCount: state.recursionCount,
            }
          );
        }

        // safe-braking-eagle: observe `max_tokens` truncation that the
        // executeRouter would otherwise route over as a normal completion.
        // A logs the event; C-2/C-3 snapshot the in-flight `<file>` /
        // `<append>` context (BEFORE finalize wipes it) so the next round
        // can resume from exactly where the LLM stopped.
        const stopReason = (event as any).stopReason as string | undefined;
        if (stopReason === 'max_tokens') {
          const taskId = state.currentTask?.id || 'unknown';
          const taskName = state.currentTask?.name || 'unknown';
          const callIdx = newCallIndex - 1;

          // Capture the open file block BEFORE finalize discards it.
          // The partial content was already streamed to disk via
          // FileRenderer's incremental writes; this hint just tells the
          // LLM where to resume with `<append>`.
          const openFile = orchestrator.getOpenFileContext();
          if (openFile) {
            state._maxTokensTruncation = {
              kind: openFile.kind,
              path: openFile.path,
              tailContent: openFile.tailContent,
            };
          }

          console.warn(
            `⚠️  [CodeGen/execute] max_tokens truncated (callIndex=${callIdx}, ` +
            `output=${capturedUsage?.outputTokens ?? LLM_MAX_TOKENS.DEFAULT}) ` +
            `for task "${taskName}" (${taskId})` +
            (openFile
              ? `. Open <${openFile.kind} path="${openFile.path}"> block detected — ` +
                `next round will receive a resume hint with the trailing ${openFile.tailContent.length} chars.`
              : `. No open <file>/<append> block — the LLM was emitting text/thinking; ` +
                `consider raising LLM_MAX_TOKENS.DEFAULT.`),
          );
          const featurePath = state.context?.featurePath;
          if (featurePath && state._httpJobId) {
            void getExecutionLogger({
              featurePath,
              jobId: state._httpJobId,
              jobType: 'code',
            })
              .log('max_tokens_truncated', {
                node: 'execute',
                callIndex: callIdx,
                outputTokens: capturedUsage?.outputTokens ?? LLM_MAX_TOKENS.DEFAULT,
                maxTokens: LLM_MAX_TOKENS.DEFAULT,
                taskName,
                taskType: state.currentTask?.type,
                openFilePath: openFile?.path,
                openFileKind: openFile?.kind,
                tailCharsCaptured: openFile?.tailContent.length ?? 0,
                recoveryHint: openFile ? 'continue-via-append' : 'partial-output-discarded',
              }, taskId)
              .catch(() => { /* non-blocking */ });
          }
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

    // Files newly written this turn surface to the LLM via conversation
    // tool_results (edit_file / create_file / delete_file) and via streamed
    // `<file>` tag markers in the assistant message — no state channel
    // carries file snapshots.

    // ✅ DIRECT MERGE: Handle cross-worker file conflicts without enforce/plan/read_file
    // Instead of: execute → checkTaskStatus → enforce → plan → execute → read_file → tool → codexecuteeGen (4-5 LLM calls)
    // Optimized:  execute → execute with merge instruction (1 LLM call)
    const fileConflicts = finalizeResult.fileConflicts || [];
    if (fileConflicts.length > 0) {
      console.log(`🔀 [execute] ${fileConflicts.length} cross-worker conflict(s) — injecting direct merge instruction`);

      // 1. Authorize worker for post-merge writes (prevents re-conflict on next write)
      const workerFSForAuth = state.deps?.fileSystem as any;
      const currentWorkerId = state.workerId ?? 0;
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

      // Assistant turn: when tool_use blocks are present in the LLM response
      // they MUST be included in history. Otherwise the tool node's trailing
      // `user(tool_result)` has no matching tool_use in the preceding
      // assistant and Anthropic API rejects with 400
      // `messages.N.content.M: unexpected tool_use_id`. The mirror of this
      // invariant lives in the normal execute-return path a few hundred
      // lines below (search for the other `buildAssistantMessage` call) —
      // keep them aligned. Regression: job `bitter-looping-nurse`
      // (2026-04-22). Plain-string assistant is only valid when no tool_use
      // exists.
      const assistantMessage = toolCalls.length > 0
        ? buildAssistantMessage({ text: cleanedResponse || undefined, toolCalls })
        : (cleanedResponse ? { role: 'assistant' as const, content: cleanedResponse } : null);

      // User turn: Anthropic requires that `assistant(tool_use)` be followed
      // by a user message whose content STARTS with `tool_result` blocks —
      // one per `tool_use_id`. If we inject merge instructions as plain
      // text here we leave the tool_use blocks orphaned and the next
      // execute LLM call rejects with 400
      // `tool_use ids were found without tool_result blocks immediately after`.
      // Regression: job `ivory-fanning-knoll` (2026-04-24). See
      // `mergeUserContent.ts` for the shared invariant + rationale.
      const mergeUserContent = buildMergeUserContent(toolCalls, mergeInstruction);

      const newHistory = [
        ...nodeExecute,
        ...(assistantMessage ? [assistantMessage] : []),
        { role: 'user' as const, content: mergeUserContent },
      ];

      // Workflow exit
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', state.workerId ?? 0);
      }

      // Suppress fileErrors while merge is in progress — returning them
      // would cause execute to route to checkTaskStatus, losing the
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
          // Clear toolCalls: synthetic tool_result blocks above already
          // closed the tool_use pairing in history. Leaving toolCalls
          // non-empty would route to the `tool` node which would append
          // ANOTHER `user(tool_result)` and produce a malformed trailing
          // sequence (see ivory-fanning-knoll regression comment above).
          toolCalls: [],
          done: false,
          tokenUsage: capturedUsage,
        },
        conversations: { [CONV_KEYS.NODE_EXECUTE]: newHistory },
        // Phase declaration — execute MUST commit `_activePhase: 'execute'`
        // on every return so a stale `'plan'` from `plan-toolLoop` cannot
        // leak into the downstream `tool` node / `routeAfterTool`. The leak
        // would route the next `tool_result` into NODE_PLAN, leaving the
        // `tool_use` in NODE_EXECUTE orphaned and producing Anthropic 400
        // `tool_use ids were found without tool_result blocks immediately
        // after`. Regression: job `wild-flying-scout` (2026-04-30).
        _activePhase: 'execute' as const,
        fileErrors: undefined,
        _executeCallIndex: newCallIndex,
        // Reset turn-scoped signal so the next execute turn (which won't
        // immediately follow another tool batch) starts with a clean slate.
        _lastToolBatchMutatedFiles: false,
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
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', state.workerId ?? 0);
    }
    
    // Cross-task propagation happens purely through disk state — the next
    // task's plan node runs its own RAG, and execute reads files on demand.

    // ✅ CRITICAL: Only mark done if LLM explicitly output <done>true</done>
    // Use explicitDone from streaming pipeline (detected by SpecialTagTransformer)
    // Previously: done = toolCalls.length === 0 (caused premature completion on truncated responses)
    let explicitDone = finalizeResult.explicitDone || false;

    // AUTO-COMPLETE: verification/error tasks that created files via <file> tag
    // without tool calls or <done> tag. Without this, the router sees no tools
    // and no done → routes back to execute → infinite file_create loop.
    // Uses `streamedFiles` (scoped to THIS iteration) so prior turns'
    // mutations cannot mistakenly auto-complete an empty turn.
    const streamedInThisCall = finalizeResult?.streamedFiles || [];
    if (!explicitDone && toolCalls.length === 0 && streamedInThisCall.length > 0
        && isRemediationTask) {
      explicitDone = true;
      console.log(`✅ [execute] Auto-completing ${state.currentTask?.type} task: ${streamedInThisCall.length} file(s) created via <file> tag`);
    }

    // Runaway is bounded by Safety Net A (recursionLimit) and Safety Net B
    // (repeated tool failures) in `executeRouter`, plus LangGraph's
    // `recursionLimit` ceiling and `batch_cycle_limit` queue-side fan-out.
    const isVerification = state.currentTask ? isVerificationTask(state.currentTask) : false;
    const toolMutatedThisTurn = state._lastToolBatchMutatedFiles === true;

    console.log(
      `[diag] execute return: ` +
      `streamed=${streamedInThisCall.length} ` +
      `toolMut=${toolMutatedThisTurn} ` +
      `planText.len=${state.planText?.length ?? 0} ` +
      `nodeExec.len=${nodeExecute.length} ` +
      `_activePhase=${state._activePhase} ` +
      `isVerification=${isVerification} ` +
      `explicitDone=${explicitDone} ` +
      `tools=${toolCalls.length}`,
    );

    
    // Thinking-only detection: log when LLM produces thinking but no text/tools
    if (toolCalls.length === 0 && !textResponse.trim() && thinking) {
      const actualEnableThinking = !isAfterToolCall && !hasRemediationPlan;
      console.warn(`⚠️  [CodeGen] THINKING-ONLY response: thinking=${thinking.length}ch, enableThinking=${actualEnableThinking}, history=${nodeExecute.length}, violations=${state.violations?.length ?? 0}`);
      if (state.context?.featurePath && state._httpJobId) {
        // Static import + synchronous writeQueue update — see executionLogger
        // contract (vast-curling-perch C-3 RCA).
        void getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'code',
        }).log('thinking_only', {
          thinkingLength: thinking.length,
          thinkingPreview: thinking.substring(0, 300),
          textResponse: textResponse.substring(0, 100),
          enableThinking: actualEnableThinking,
          toolsAvailable: tools?.length ?? 0,
          nodeHistoryLength: nodeExecute.length,
          violationsCount: state.violations?.length ?? 0,
          callIndex: newCallIndex,
        }, state.currentTask?.id).catch(() => { /* non-blocking */ });
      }
    }

    if (toolCalls.length === 0 && !explicitDone) {
      console.warn(`⚠️  [execute→execute] No tool calls and no <done>true</done> tag - LLM response may be incomplete`);
      
      // Preserve LLM response in node history to prevent amnesia.
      // Without this, execute→execute loop loses all memory of previous response,
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

      // dim-beating-brass RCA — "marker mimicry": the model can type the
      // literal status text `[file written to disk: X]` instead of a real
      // <file> tag, so nothing is written. `cleanFileContentFromResponse`
      // strips real <file> bodies, so a marker SURVIVING in the cleaned text
      // while ZERO files were streamed can only have been typed by the model.
      const typedPhantomMarker =
        streamedFilePaths.length === 0 &&
        /\[file (?:written to disk|edited|appended):\s*[^\]]+\]/.test(cleanedResponse);
      if (typedPhantomMarker) {
        // Neutralize the hallucinated marker before it enters history — left
        // intact, `compactTurns.extractFactsFromMessages` would later parse it
        // as a genuine write and re-inject the false "already saved" belief.
        cleanedResponse = cleanedResponse.replace(
          /\[file (?:written to disk|edited|appended):\s*[^\]]+\]/g,
          '(emitted marker text only — NO file was written)',
        );
      }

      // Thinking-only response: LLM produced a thinking block but no text/tools.
      // Preserve the thinking content so the next call has context and
      // enableThinking switches to false (isAfterToolCall becomes true).
      if (!cleanedResponse && thinking) {
        cleanedResponse = `[Previous reasoning (no action taken): ${thinking.substring(0, 500)}]`;
      }
      
      if (cleanedResponse) {
        // Build re-entry message with specific file list so the LLM doesn't
        // have to search through history to find which files already exist.
        const reentryParts: string[] = [];
        if (typedPhantomMarker) {
          // Truthful correction. The previous "files already saved — do NOT
          // recreate" guidance is exactly what spiralled the model on
          // dim-beating-brass: it confirmed the false belief that typing the
          // marker had saved the file. Tell it the truth and show the real tag.
          reentryParts.push(
            '⚠️ NO file was written. Your previous response contained literal text like',
            '"[file written to disk: ...]" but NOT a real <file> tag.',
            '',
            'That bracket is a status RECORD the system shows AFTER a real tag is saved —',
            'typing it yourself writes nothing. To create a file, your output must contain a',
            'real tag whose first token is `<`:',
            '',
            '  <file path="src/...">...the full file content, verbatim...</file>',
            '',
            'Emit the real <file> tag now for the file you intended to write.',
          );
        } else {
          reentryParts.push(
            'Your previous response did not include any tool calls or <done>true</done>.',
          );
          if (streamedFilePaths.length > 0) {
            reentryParts.push(
              '',
              `The following ${streamedFilePaths.length} file(s) are already saved to disk — do NOT recreate them:`,
              ...streamedFilePaths.map(fp => `  - ${fp}`),
            );
          }
          const doneHint = isRemediationTask
            ? 'If you have applied all fixes from the remediation plan, output <done>true</done> now. Do NOT run build/test — a separate diagnostic phase re-verifies automatically.'
            : 'If you have completed all work for this task, output <done>true</done> now.';
          reentryParts.push(
            '',
            doneHint,
            'If there is remaining work, continue with NEW files only.',
          );
        }

        const newHistory = [
          ...nodeExecute,
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
          conversations: { [CONV_KEYS.NODE_EXECUTE]: newHistory },
          _activePhase: 'execute' as const,
          fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
          _executeCallIndex: newCallIndex,
          // Reset the turn-scoped tool-mutation signal — execute consumed
          // it; the next turn starts fresh and only re-flips when another
          // tool batch mutates files.
          _lastToolBatchMutatedFiles: false,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          profile: state.profile,
        };
      }
    }
    
    // When tool calls exist, push assistant message so tool node receives
    // a complete [assistant, user(tool_result)] pair in conversation history.
    const toolCallHistory = toolCalls.length > 0
      ? [...nodeExecute, buildAssistantMessage({
          text: cleanFileContentFromResponse(textResponse) || undefined,
          toolCalls,
        })]
      : undefined;

    return {
      llmResponse: {
        thinking,
        thinkingSignature: thinkingSignature || undefined,
        textResponse,
        toolCalls,
        done: explicitDone,
        tokenUsage: capturedUsage,
      },
      ...(toolCallHistory ? { conversations: { [CONV_KEYS.NODE_EXECUTE]: toolCallHistory } } : {}),
      _activePhase: 'execute' as const,
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
      _executeCallIndex: newCallIndex,
      // Reset turn-scoped tool-mutation signal (see top of execute return
      // section for rationale).
      _lastToolBatchMutatedFiles: false,
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
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'execute', state.workerId ?? 0);
    }
    
    throw error;
  }
}

