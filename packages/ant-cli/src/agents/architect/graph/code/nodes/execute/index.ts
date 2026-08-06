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
import { ToolFileStreamer } from '../../../../../../core/streaming/ToolFileStreamer';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';

// Import submodules
import { buildMessages } from './buildMessages';
import { getTools } from './tools';
import {
  applyDrainFinalization,
  computeNextNoProgressStreak,
  computeNextNoOutputStreak,
  computeNextRecentTextHashes,
  isRepeatedAssistantText,
} from './drainFinalize';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import { logger } from '../../../../../../utils/logger';
import { ArtifactService } from '../../../../../../infrastructure/workspace/ArtifactService';
import { normalizeToCodebasePath } from '../../../../../../core/utils/pathNormalizer';
import { resolveCodebaseRel } from './codebaseRel';
import { cleanFileContentFromResponse } from '../../utils/responseCleaners';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET, LLM_TEMPERATURE } from '../../../../../common/graph/llmConfig';
import { getJobAbortSignal } from '../../../../../../composition/jobAbort';
import { maybeJoinSubagents, ownerKeyFor } from '../../../../../common/subagent';
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from '../../../../../common/graph/llmHelpers';
import { isVerificationTask } from '../../tasks/verification';
import { isUiTask } from '../../tasks/ui';
import { isErrorTask } from '../../tasks/error';
import type { CodeTask } from '../../../../types/task';

export async function execute(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  logger.debug('💭 [Execute] Starting reasoning...');

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
      logger.debug(`📋 [CodeGen] Session manifest: ${otherTaskFiles.length} file(s) from other tasks`);
    }
  } else if (workerFSForManifest?.sharedBuffer?.getWrittenFilesByOtherWorkers) {
    const currentWorkerId = state.workerId ?? 0;
    const otherWorkerFiles: Array<{ path: string; taskName?: string }> =
      workerFSForManifest.sharedBuffer.getWrittenFilesByOtherWorkers(currentWorkerId);
    if (otherWorkerFiles.length > 0) {
      state._otherWorkerFiles = otherWorkerFiles;
      logger.debug(`📋 [CodeGen] Session manifest: ${otherWorkerFiles.length} file(s) from other workers (legacy fallback)`);
    }
  }

  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);

  // Tool activation: mode-aware selection is encapsulated in `./tools.ts`
  // (NODE_GRAPH_LAYOUT.md §2.2 — caller is a single `await getTools(state)` line).
  const isExplainMode = state.resolvedAction?.mode === 'explain';
  const allTools = await getTools(state);

  // No-progress salvage (rocky-beating-coral RCA): once `_noProgressStreak`
  // nears the router breaker, narrow the advertised tools to the write set
  // (toolChoice={allow: create/append/edit} — declarations never deleted)
  // and append a persistent "apply your changes now" note to the trailing
  // user message (post-composeMessages — never inside a cached prefix).
  const { tools, toolChoice, drainFinalizing } = applyDrainFinalization(state, messages, allTools);
  
  if (!state.resolvedAction?.mode) {
    console.warn(`⚠️ [CodeGen] resolvedAction.mode is missing — defaulting to tools enabled`);
  }
  
  if (isExplainMode) {
    logger.debug(`💡 [CodeGen] Explain mode - read-only tools enabled`);
  } else {
    logger.debug(`🔧 [CodeGen] Tool calling enabled (code job, mode=${state.resolvedAction?.mode || 'unknown'})`);
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

  // ✅ Setup XML Parser + StreamOrchestrator (thinking / plan / task_response
  // rendering — file writes go through the tool channel exclusively)
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');

  // One-shot disk listing of `codebase/`, captured into
  // `_existingCodebaseFiles` so `buildTaskInvariantContext` can surface a
  // path manifest to the LLM. This is the file-awareness channel that
  // replaced the `projectCodeContext` injection removed in commit cbb4d924.
  //
  // All paths are normalised via normalizeToCodebasePath to stay consistent
  // with what the file tool handlers write (`"src/app/x"` vs
  // `"codebase/src/app/x"`).
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
        existingCodebaseDiskFiles.push(normalized);
      }
    } catch (err) {
      console.warn(`⚠️  [CodeGen] listFiles('codebase') failed — existing-file manifest will be empty this turn:`, err instanceof Error ? err.message : err);
    }
  }

  logger.debug(`📊 [CodeGen] existing codebase files listed from disk: ${existingCodebaseDiskFiles.length} path(s)`);

  // Publish the disk listing to state so `buildTaskInvariantContext` can
  // render the `Existing Codebase Files` manifest. Cross-worker writes are
  // surfaced separately via `_otherWorkerFiles` (populated upstream) and
  // must NOT be mixed in here.
  state._existingCodebaseFiles = existingCodebaseDiskFiles;

  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
  });
  
  // Collect LLM output
  let thinking = '';
  let thinkingSignature = '';
  let textResponse = '';
  let isDone = false;  // ✅ Track done event (don't propagate immediately)
  // max_tokens truncation with NO open file write — the discarded-output
  // flavor (see the stopReason handler). Read by the no-progress streak
  // computation and the history-hygiene stub in the return section.
  let maxTokensTruncatedNoFile = false;
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

  // Live rendering of file-writing TOOL CALLS (create_file / append_file /
  // edit_file): tool_use_delta fragments open the card shell on `path` and
  // stream content line-by-line into the live file card.
  let toolStreamer = new ToolFileStreamer(chatAPI);

  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmToUse.stream(messages, {
      tools,
      ...(toolChoice && tools.length > 0 ? { toolChoice } : {}),
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      temperature: LLM_TEMPERATURE.CODE_EXECUTE,
      enableThinking: !isAfterToolCall && !hasRemediationPlan,
      thinkingBudget: LLM_THINKING_BUDGET.CODE_EXECUTE,
      signal: getJobAbortSignal(),
    })) {
      if (event.type === 'retry') {
        thinking = '';
        thinkingSignature = '';
        textResponse = '';
        isDone = false;
        toolCalls.length = 0;
        capturedUsage = undefined;
        // Fresh streamer per attempt — a retried stream re-sends the tool
        // call from scratch, and stale card state would double-render.
        toolStreamer = new ToolFileStreamer(chatAPI);
        continue;
      }

      // In-flight gauge update from usage_partial events (Anthropic/Gemini).
      // Overwrite-only; job/task counters are updated at 'done' below.
      maybeUpdatePhaseTokenUsage(state, event);

      await orchestrator.processEvent(event);
      toolStreamer.handleEvent(event);
      
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
          // Attribute to the execute node's actual model (may differ from job default).
          accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: true, modelId: llmToUse.modelName });
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
              modelId: llmToUse.modelName,
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
        // Log the event and snapshot the in-flight tool-channel write (a
        // create_file/append_file call truncated mid-arguments — the
        // ToolFileStreamer salvage context) so the next round can resume
        // from exactly where the LLM stopped.
        const stopReason = (event as any).stopReason as string | undefined;
        if (stopReason === 'max_tokens') {
          const taskId = state.currentTask?.id || 'unknown';
          const taskName = state.currentTask?.name || 'unknown';
          const callIdx = newCallIndex - 1;

          const openToolFile = toolStreamer.getOpenToolFile();
          if (openToolFile?.path && openToolFile.toolName !== 'edit_file') {
            // A truncated tool call never executes, so (unlike the tag
            // channel's buffered partial) nothing reached disk. Settle the
            // live card as failed and hand the next round a resume hint —
            // it re-issues the write with the tail as its continuity anchor.
            const salvagePath = openToolFile.path;
            void chatAPI.failFileCreation(
              salvagePath,
              'Output token limit hit mid-write — the next round re-issues this file.',
            ).catch(() => {});
            state._maxTokensTruncation = {
              kind: openToolFile.toolName === 'append_file' ? 'append' : 'file',
              path: salvagePath,
              tailContent: openToolFile.tailContent,
            };
          } else {
            // The whole output budget went to text/thinking without even
            // opening a file write on either channel. Feeds the
            // drain-truncation breaker escalation and the history-hygiene
            // stub below (vivid-orbiting-dodge call 219: 64K tokens / 17 min
            // of one repeated sentence, truncated with zero salvageable output).
            maxTokensTruncatedNoFile = true;
          }

          console.warn(
            `⚠️  [CodeGen/execute] max_tokens truncated (callIndex=${callIdx}, ` +
            `output=${capturedUsage?.outputTokens ?? LLM_MAX_TOKENS.DEFAULT}) ` +
            `for task "${taskName}" (${taskId})` +
            (openToolFile?.path && openToolFile.toolName !== 'edit_file'
              ? `. Truncated ${openToolFile.toolName} call for "${openToolFile.path}" ` +
                `(${openToolFile.contentSoFar.length} chars parsed) — next round receives a resume hint.`
              : `. No open file write — the LLM was emitting text/thinking; ` +
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
                openFilePath: openToolFile?.path,
                tailCharsCaptured: openToolFile?.tailContent.length ?? 0,
                recoveryHint: openToolFile?.path ? 'reissue-truncated-write' : 'partial-output-discarded',
              }, taskId)
              .catch(() => { /* non-blocking */ });
          }
        }
      }
    }

    // Flush queued tool-channel live-card emissions BEFORE finalizing.
    await toolStreamer.settle();

    // Propagate done event
    if (isDone) {
      await chatAPI.sendLLMEvent({ type: 'done' });
    }

    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);

    // Output-side no-progress signal (vivid-orbiting-dodge RCA). Computed
    // once here; every return path below commits the updated ring alongside
    // `_noProgressStreak` so the two channels never drift.
    const repeatedIdenticalText = isRepeatedAssistantText(
      state._recentExecuteTextHashes,
      textResponse,
    );
    const nextTextRing = computeNextRecentTextHashes(
      state._recentExecuteTextHashes,
      textResponse,
    );

    // Files newly written this turn surface to the LLM via conversation
    // tool_results (create_file / append_file / edit_file / delete_file) —
    // no state channel carries file snapshots.

    // Finalize chat message if no tool calls (task/reasoning complete)
    if (toolCalls.length === 0) {
      const chatAPI = getChatAPIClient();
      await chatAPI.finalizeMessage();
    }

    logger.debug(`✅ [CodeGen] Complete: ${toolCalls.length} tools${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);
    
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

    // AUTO-COMPLETE: verification/error tasks whose previous tool batch
    // mutated files but whose follow-up turn emitted neither tool calls nor
    // a <done> tag. Without this, the router sees no tools and no done →
    // routes back to execute → infinite loop. `_lastToolBatchMutatedFiles`
    // is turn-scoped (reset on every execute return), so a stale mutation
    // from an earlier round cannot auto-complete an empty turn.
    if (!explicitDone && toolCalls.length === 0
        && state._lastToolBatchMutatedFiles === true
        && isRemediationTask) {
      explicitDone = true;
      console.log(`✅ [execute] Auto-completing ${state.currentTask?.type} task: previous tool batch mutated files`);
    }

    // Runaway is bounded by Safety Net A (recursionLimit, verification-gated)
    // and Safety Net B (repeated tool FAILURES) in `executeRouter`, LangGraph's
    // `recursionLimit` ceiling, `batch_cycle_limit` queue-side fan-out, and —
    // for SUCCESS-blind degenerate loops (rocky-beating-coral: 296 rounds of
    // duplicate re-reads) — the no-progress circuit breaker fed by
    // `_noProgressStreak` below.
    const isVerification = state.currentTask ? isVerificationTask(state.currentTask) : false;
    const toolMutatedThisTurn = state._lastToolBatchMutatedFiles === true;
    const progressed = toolMutatedThisTurn || explicitDone;

    // No-progress streak (single computation; committed on every return path
    // below). Progress = tool mutation or explicit <done>.
    const nextNoProgressStreak = computeNextNoProgressStreak(state, {
      progressed,
      drainFinalizing,
      toolCallCount: toolCalls.length,
      repeatedIdenticalText,
      // Drain turn that burned its whole output budget on text without even
      // opening a file write → escalate straight to the router breaker
      // instead of granting the remaining drain turns (each is a potential
      // repeat of vivid-orbiting-dodge's 64K-token / 17-minute call 219).
      drainTruncatedNoFile: drainFinalizing && maxTokensTruncatedNoFile,
    });

    // No-forward-output streak (cyan-catching-cedar RCA): counts consecutive
    // execute turns with tool calls but zero mutation/<done>, regardless
    // of read/search novelty — the "rounds since forward output" signal that
    // `_noProgressStreak` (info-gain only) cannot see. Reuses the same
    // `progressed` disjunction; committed on every return path below.
    const nextNoOutputStreak = computeNextNoOutputStreak(state, {
      progressed,
      toolCallCount: toolCalls.length,
      drainFinalizing,
    });

    console.log(
      `[diag] execute return: ` +
      `toolMut=${toolMutatedThisTurn} ` +
      `noProgress=${nextNoProgressStreak} ` +
      `noOutput=${nextNoOutputStreak} ` +
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

      // dim-beating-brass RCA — "marker mimicry": the model can type the
      // literal status text `[file written to disk: X]` instead of issuing a
      // real file-writing tool call, so nothing is written. A marker in the
      // text while this turn issued zero tool calls and the previous batch
      // mutated nothing can only have been typed by the model.
      const typedPhantomMarker =
        !toolMutatedThisTurn &&
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

      // History hygiene for discarded max_tokens truncations: the full text
      // (up to the entire output budget — 64K tokens on vivid-orbiting-dodge
      // call 219) has zero salvage value, re-bills as uncached input next
      // round, and feeds the very repetition attractor that produced it.
      // A head excerpt + truncation marker preserves the anti-amnesia intent.
      if (maxTokensTruncatedNoFile && cleanedResponse.length > 700) {
        cleanedResponse =
          `${cleanedResponse.slice(0, 500)}\n` +
          `[response truncated at ${capturedUsage?.outputTokens ?? 'the maximum'} output tokens ` +
          `without producing any file output — the rest was repetitive text and has been ` +
          `discarded. Do NOT restart that narration; issue the intended create_file / edit_file ` +
          `tool calls directly.]`;
      }
      
      if (cleanedResponse) {
        // Build the re-entry message.
        const reentryParts: string[] = [];
        if (typedPhantomMarker) {
          // Truthful correction. The previous "files already saved — do NOT
          // recreate" guidance is exactly what spiralled the model on
          // dim-beating-brass: it confirmed the false belief that typing the
          // marker had saved the file. Tell it the truth and show the real channel.
          reentryParts.push(
            '⚠️ NO file was written. Your previous response contained literal text like',
            '"[file written to disk: ...]" but NOT a real file-writing tool call.',
            '',
            'That bracket is a status RECORD the system shows AFTER a real write lands —',
            'typing it yourself writes nothing. To create or modify a file, you must CALL a',
            'tool: create_file (new file), append_file (tail concat), or edit_file (partial change).',
            '',
            'Issue the real tool call now for the file you intended to write.',
          );
        } else {
          reentryParts.push(
            'Your previous response did not include any tool calls or <done>true</done>.',
          );
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
          _executeCallIndex: newCallIndex,
          // Reset the turn-scoped tool-mutation signal — execute consumed
          // it; the next turn starts fresh and only re-flips when another
          // tool batch mutates files.
          _lastToolBatchMutatedFiles: false,
          _lastToolBatchAllDupReads: false,
          _noProgressStreak: nextNoProgressStreak,
          _noOutputStreak: nextNoOutputStreak,
          _recentExecuteTextHashes: nextTextRing,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
          profile: state.profile,
        };
      }
    }
    
    // ── Join barrier (explore subagent): the LLM wants to finish this task
    // (<done>, no tool calls) while reports are still owed. Withhold `done`
    // — routeAfterExecute rule 3 (no tools + no done) re-enters execute —
    // deliver the reports as a user turn, and let the LLM re-decide with
    // them in context. Drain normally happens every tool round (tool node),
    // so this fires only when a child outlives the parent's last tool batch.
    if (explicitDone && toolCalls.length === 0) {
      const subagentOwnerKey = ownerKeyFor(state._httpJobId);
      // No hasPending pre-gate: settled-but-undelivered reports (child finished
      // after the last tool batch) must join too — maybeJoinSubagents returns
      // null when nothing is owed. (cyan-driving-apron E2E: the pre-gate
      // dropped settled reports at task completion.)
      {
        const joined = await maybeJoinSubagents(state as any, subagentOwnerKey, { history: nodeExecute });
        if (joined) {
          const withheldText = cleanFileContentFromResponse(textResponse)
            || '(completion withheld — subagent reports pending)';
          const joinHistory = [
            ...nodeExecute,
            { role: 'assistant' as const, content: withheldText },
            {
              role: 'user' as const,
              content: [
                ...joined.blocks,
                {
                  type: 'text' as const,
                  text: 'All pending subagent reports are delivered above. Incorporate them into your work; if the task is still complete as-is, output <done>true</done> again.',
                },
              ],
            },
          ];
          console.log(`🔀 [execute] <done> withheld — subagent reports delivered, re-entering execute`);
          return {
            llmResponse: {
              thinking,
              thinkingSignature: thinkingSignature || undefined,
              textResponse,
              toolCalls,
              done: false,
              tokenUsage: capturedUsage,
            },
            conversations: { [CONV_KEYS.NODE_EXECUTE]: joinHistory },
            _activePhase: 'execute' as const,
            _executeCallIndex: newCallIndex,
            _lastToolBatchMutatedFiles: false,
            _lastToolBatchAllDupReads: false,
            // Subagent reports delivered = novel information, not a loop.
            _noProgressStreak: 0,
            _noOutputStreak: 0,
            _recentExecuteTextHashes: nextTextRing,
            recursionCount: state.recursionCount,
            recursionLimit: state.recursionLimit,
            profile: state.profile,
            ...(joined.tokenDelta as any),
          };
        }
      }
    }

    // When tool calls exist, push assistant message so tool node receives
    // a complete [assistant, user(tool_result)] pair in conversation history.
    // Thinking block (with signature) is preserved: adaptive models now run
    // thinking on every round (see AnthropicLLMClient.buildThinkingParams),
    // and the API contract requires a tool_use-bearing assistant turn to
    // carry its thinking block unchanged on same-model continuation. The
    // plan tool-loop (runPlanWithTools) already preserves it — keep aligned.
    const toolCallHistory = toolCalls.length > 0
      ? [...nodeExecute, buildAssistantMessage({
          thinking: thinking || undefined,
          thinkingSignature: thinkingSignature || undefined,
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
      _executeCallIndex: newCallIndex,
      // Reset turn-scoped tool-mutation signal (see top of execute return
      // section for rationale).
      _lastToolBatchMutatedFiles: false,
      _lastToolBatchAllDupReads: false,
      _noProgressStreak: nextNoProgressStreak,
      _noOutputStreak: nextNoOutputStreak,
      _recentExecuteTextHashes: nextTextRing,
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

