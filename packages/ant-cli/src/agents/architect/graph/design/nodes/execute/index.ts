/**
 * Execute Node - 문서 생성 추론 (Design Job용 LLM)
 *
 * 책임:
 * - LLM 호출 및 스트리밍
 * - Thinking/Text 수집
 * - Tool Call 감지 (실행은 하지 않음! 파일 쓰기는 create_file /
 *   append_file / edit_file 도구 채널 전용 — ToolFileStreamer가 라이브 렌더)
 *
 * 하지 않는 것:
 * - Tool 실행
 * - 파일 쓰기 (tool 노드가 담당)
 * - 루프 (LangGraph가 관리)
 *
 * ✅ UI Design 모드 지원 (detectedIntentGroup === 'design-ui')
 *     - by-figma: Figma MCP 구조적 데이터 추출
 *     - by-desc: directive + PRD 기반 직접 작성
 *     - ui-tokens.json, ui-assets.json, ui-spec.json 생성
 */

import type { MessageContentBlock } from '../../../../../../core/ports/llm';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { DesignGraphState } from '../../state';
import { maybeJoinSubagents, ownerKeyFor } from '../../../../../common/subagent';
import { applyDrainFinalization, computeNextNoOutputCount } from './drainFinalize';
import { designTargetExists } from '../checkTaskStatus/outputVerification';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { ToolFileStreamer } from '../../../../../../core/streaming/ToolFileStreamer';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET, LLM_TEMPERATURE } from '../../../../../common/graph/llmConfig';
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from '../../../../../common/graph/llmHelpers';
import { measurePromptChars } from '../../../../../../core/utils/promptLogger';
import { getTools } from './tools';
import { resolveLLMClient } from './llmClient';
import { getJobAbortSignal } from '../../../../../../composition/jobAbort';
import { applyClarifyGate, consumeAwaitingClarify, type ClarifyConsumePatch } from '../../../../../common/clarify';
import type { IntentId } from '@ant/shared';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { saveClarifyCheckpoint } from '../../session/checkpoint';
import { isPrdSyncTask } from '@ant/shared';

// ✅ Import prompt builders from sub-modules
import { buildMessages } from './intent/system';
import { buildUiDesignMessages } from './intent/ui';
import { buildGameArtMessages } from './intent/game-art';
import { buildSpecMessages } from './intent/spec';
import { buildPrdSyncMessages } from './intent/prd-sync';
import { renderExplainResponse } from './explain';

export async function execute(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Increment execute call index (telemetry / displayed in warnings).
  // No longer a safety-net gate — runaway is bounded by LangGraph recursionLimit.
  const newCallIndex = (state._executeCallIndex || 0) + 1;
  
  // Per-node model selection — honors `llmModels.design.execute` (falls
  // back to the design default when unset / no workspaceConfig). Mirrors
  // plan/decompose so execute is no longer the odd node stuck on default.
  const llmClient = await resolveLLMClient(state);
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ Build messages based on intent group
  const intentGroup = state.resolvedAction?.intentGroup;
  const isExplainMode = state.resolvedAction?.mode === 'explain'
    || state.currentTask?.type === 'explain';

  // ✅ Log iteration start info (per-call debugging, like code job's execute)
  const taskTokensSoFar = state._currentTaskTokenUsage;
  console.log(`\n💭 [Execute] Starting iteration ${newCallIndex} for task "${state.currentTask?.name || 'unknown'}"`);
  console.log(`   Intent group: ${intentGroup || 'unknown'}`);

  // Explain mode: chat-only response — no XML parsing, no disk artifact.
  // Branch BEFORE the intentGroup splits so the persisted-artifact templates
  // (system-design / design-spec / design-ui) never run for an explain task.
  if (isExplainMode) {
    state._executeCallIndex = newCallIndex;
    console.log(`📝 [Execute] explain mode — chat-only response, file write skipped`);
    return await renderExplainResponse(state);
  }
  // Tool-channel half of the R5 gate (see turnHadArtifactMutationIntent):
  // the previous round's tool batch landed at least one SUCCESSFUL artifact
  // write (`_turnToolWrites`, folded from sideEffects by the tool node), so
  // this round's prompt should carry the "artifact updated — is the scope
  // satisfied?" self-check. Success-based on purpose: failed edit_file calls
  // must not forge the check (sharp-baking-bride RCA).
  if (!state._pendingDoneCheck && (state._turnToolWrites || 0) > 0) {
    state._pendingDoneCheck = true;
  }

  const nodeExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  console.log(`   Conversation history: ${nodeExecute.length} messages`);
  if (taskTokensSoFar?.totalTokens) {
    console.log(`   Task tokens so far: ${taskTokensSoFar.totalTokens} (in=${taskTokensSoFar.inputTokens} out=${taskTokensSoFar.outputTokens})`);
  }
  
  // ✅ Spec clarify continuation: append user's clarify response to NODE_EXECUTE
  // via the shared helper. Gated on `intentGroup === 'design-spec'` because
  // only spec clarify writes the execute-kind checkpoint; other intent groups
  // never set `awaitingClarify` on this state.
  // `clarifyPatch` is what actually clears the channel — the helper's mutation
  // is node-local, so a return that omits it leaves `awaitingClarify` true and
  // the guard re-appends the answer on every re-entry (from `tool` / join redo).
  let clarifyPatch: ClarifyConsumePatch = {};
  if (intentGroup === 'design-spec' && state.awaitingClarify && state.overrideDirective) {
    console.log(`📋 [Execute/Spec] Clarify continuation — appending user response to conversation`);
    clarifyPatch = consumeAwaitingClarify(state, CONV_KEYS.NODE_EXECUTE);
  }
  
  let messages;
  let useSourceFileTool = false;

  // Cross-intent PRD sync: a `doc` task carrying a `prdSyncTargets` grant is
  // reframed as a surgical full-rewrite of the named plan doc, regardless of
  // which design intent produced the job. Branch BEFORE the intentGroup split
  // so the sync task never hits the authoring builder (system / ui / spec /
  // game-art) for its host intent.
  const isPrdSync = isPrdSyncTask(state.currentTask);
  if (isPrdSync) {
    messages = await buildPrdSyncMessages(state);
  } else if (intentGroup === 'design-ui') {
    messages = await buildUiDesignMessages(state);
  } else if (intentGroup === 'design-game-art') {
    // Game-domain peer of design-ui (D28). Game-art catalogs are JSON like UI,
    // NOT markdown system docs — route to the dedicated game-art builder rather
    // than falling through to the system-design path.
    messages = await buildGameArtMessages(state);
  } else if (intentGroup === 'design-spec') {
    messages = await buildSpecMessages(state);
  } else {
    const result = await buildMessages(state);
    messages = result.messages;
    useSourceFileTool = result.useSourceFileTool;
  }
  
  // Figma mode detection (used for budget threshold tuning; tool selection
  // lives in ./tools.ts and mirrors the same predicates there).
  const { isFigmaPipeline, isFigmaDataPopulated } = await import('@ant/shared');
  const isFigmaUiDesign = intentGroup === 'design-ui' && isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));

  // Progressive no-output-streak nudge injection (advisory, not enforced —
  // runaway is bounded by LangGraph `recursionLimit` upstream).
  // Figma tasks get higher thresholds to accommodate drill-down queries.
  // When `state.planText` is sealed, plan owns architectural exploration;
  // execute's role is "render the decision + verify a few exact paths" — so
  // tighten the nudges. When no plan is sealed (legacy / dispatcher fallback),
  // keep the original budget so Codebase Exploration heuristics have room.
  const hasFigmaTools = isFigmaUiDesign || (intentGroup === 'design-spec' && state.figmaAvailable === true);
  const hasSealedPlan = !!state.planText && state.planText.trim().length > 0;
  const softWarnAt = hasFigmaTools ? 10 : (hasSealedPlan ? 4 : 7);
  const hardWarnAt = hasFigmaTools ? 14 : (hasSealedPlan ? 7 : 10);
  const noOutputCount = state._noOutputCallCount || 0;
  if (noOutputCount >= 1) {
    let warningText: string;
    if (noOutputCount >= hardWarnAt) {
      warningText = `\n\n[no-output streak: ${noOutputCount} turns]\n` +
        `You have been reading without producing output. Write the document body NOW via create_file / append_file (or edit_file for an existing target) using the conversation history — continued read-only calls just consume your turn budget without progress.`;
    } else if (noOutputCount >= softWarnAt) {
      warningText = `\n\n[no-output streak: ${noOutputCount} turns]\n` +
        `Begin writing the document body via create_file / append_file tool calls. Further reads are unlikely to add necessary information.`;
    } else {
      warningText = `\n\n[no-output streak: ${noOutputCount} turns]\n` +
        `Reminder: prefer broad reads (300-500+ lines) and start writing by call ${softWarnAt}.`;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      if (Array.isArray(lastMsg.content)) {
        (lastMsg.content as any[]).push({ type: 'text', text: warningText });
      } else if (typeof lastMsg.content === 'string') {
        lastMsg.content = [
          { type: 'text', text: lastMsg.content },
          { type: 'text', text: warningText },
        ];
      }
    }
    const level = noOutputCount >= hardWarnAt ? 'URGENT' : noOutputCount >= softWarnAt ? 'WARNING' : 'INFO';
    console.log(`⚠️  [Execute] No-output streak ${level}: ${noOutputCount} turns`);
  }

  // Tool activation: delegate to the per-node tools.ts selector so the
  // execute node body stays focused on streaming / parsing.
  // Drain-time forced finalization (see ./drainFinalize.ts) may narrow the
  // tool list and append a "emit final output now" note to the messages.
  // `targetExists` dispatches the drain exit affordance: an existing target
  // keeps edit/append (REVISE exit), a not-yet-created one advertises
  // create/append instead (sharp-baking-bride RCA).
  const targetExists = await designTargetExists(
    state.deps?.fileSystem as any,
    state.context?.featurePath,
    state.currentTask,
  );
  const { tools, toolChoice, drainFinalizing, salvageTools } = applyDrainFinalization(
    state,
    messages,
    // PRD sync is a no-tool full rewrite: the current doc is injected in the
    // prompt, so no exploration tools are offered (mirrors the code prd-sync
    // no-tool-loop model).
    isPrdSync ? [] : await getTools(state, { useSourceFileTool }),
    { targetExists },
  );
  
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
      state._httpJobId, 'execute', state.workerId ?? 0, taskInfo,
      llmClient ? extractLLMInfo(llmClient) : undefined,
      state.recursionCount, state.recursionLimit
    );
  }
  
  // ✅ Setup XML Parser + StreamOrchestrator (thinking / clarify /
  // task_response rendering — file writes go through the tool channel)
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');

  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
  });
  
  // ✅ Collect LLM output
  let thinking = '';
  let thinkingSignature = '';
  let textResponse = '';
  let capturedUsage: any = undefined;
  
  // ✅ Calculate maxTokens based on task line budget
  const maxTokens = calculateMaxTokens(state);
  
  // ✅ Track tool calls for routing decision
  let pendingToolCalls: Array<{ id: string; name: string; args: any }> = [];
  
  // ✅ Check if this is a continuation after tool calling (Code job pattern)
  const isAfterToolCall = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length > 0;
  
  try {
    // T1 pre-call estimate — covers every execute round (continuation after
    // tool-result merges new messages into history).
    applyEstimatedInputTokensFromMessages(state, messages);
    // ✅ Stream with XML parsing + tool calling support
    // Per-round thinking (code-execute / 5e981a1f contract): ON for round 0
    // (initial doc reasoning), OFF on tool-continuation rounds. Adaptive
    // Anthropic ignores this (always thinks); it bounds toggle providers
    // (GLM/DeepSeek unbounded) whose every-round reasoning overflows max_tokens.
    // Thinking blocks are preserved in conversation history by the tool node so
    // the API accepts them on subsequent turns.
    // Live rendering of file-writing TOOL CALLS (create_file / append_file /
    // edit_file) into the chat/editor surface.
    let toolStreamer = new ToolFileStreamer(chatAPI);

    for await (const event of llmClient.stream(messages, {
      tools: tools && tools.length > 0 ? tools : undefined,
      ...(toolChoice && tools && tools.length > 0 ? { toolChoice } : {}),
      maxTokens,
      temperature: LLM_TEMPERATURE.DOC_GENERATION,
      enableThinking: !isAfterToolCall,
      thinkingBudget: !isAfterToolCall ? LLM_THINKING_BUDGET.PLAN : undefined,
      // User Stop severs the HTTP stream immediately (code-execute parity).
      signal: getJobAbortSignal(),
    })) {
      if (event.type === 'retry') {
        thinking = '';
        thinkingSignature = '';
        textResponse = '';
        capturedUsage = undefined;
        pendingToolCalls = [];
        toolStreamer = new ToolFileStreamer(chatAPI);
        continue;
      }

      maybeUpdatePhaseTokenUsage(state, event);

      // ✅ Pass to orchestrator for XML parsing (thinking / clarify / plan tags)
      await orchestrator.processEvent(event);
      toolStreamer.handleEvent(event);
      
      // Thinking
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
        if (event.signature) {
          thinkingSignature = event.signature;
        }
      }
      
      // Text
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      // ✅ Tool Use - capture for routing
      if (event.type === 'tool_use') {
        const toolEvent = event as { 
          type: 'tool_use'; 
          toolUse: { id: string; name: string; input: Record<string, any> };
        };
        if (toolEvent.toolUse) {
          pendingToolCalls.push({
            id: toolEvent.toolUse.id,
            name: toolEvent.toolUse.name,
            args: toolEvent.toolUse.input,
          });
        }
      }
      
      if (event.type === 'done') {
        // ✅ Extract token usage
        const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Flush queued tool-channel live-card emissions BEFORE finalizing
    // (parity with code job execute/index.ts)
    await toolStreamer.settle();

    // ✅ Finalize orchestrator (flush buffer)
    const hasToolCalls = pendingToolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);  // Don't flush if tool calls pending

    // Extract explicitDone from finalize result
    const explicitDone = finalizeResult.explicitDone || false;
    
    const nodeHistory = buildNodeHistory(state, messages, thinking, thinkingSignature, textResponse, hasToolCalls, pendingToolCalls);
    
    // Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage, logTokenUsageToFile, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      // Attribute to execute's actual (per-node-resolved) model, not the
      // graph-default — `resolveModelIdSafe(state)` reads state.deps.llm.
      const executeModelId = llmClient.modelName;
      accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: false, modelId: executeModelId });
      updateKanbanTokenUsage(state);
      
      const taskUsage = state._currentTaskTokenUsage;
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        capturedUsage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'execute',
          callIndex: newCallIndex - 1,
          modelId: executeModelId,
          nodeHistoryLength: getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length,
          // The tokenLogger spreads this conditionally, so omitting it made the
          // field vanish from all 21 execute records even though the counter was
          // right here — the schema promised it and every row silently lied.
          recursionCount: state.recursionCount,
          estimatedPromptChars: measurePromptChars(messages as any[]),
          taskCumulativeInput: taskUsage?.inputTokens || 0,
          taskCumulativeOutput: taskUsage?.outputTokens || 0,
        }
      );
    }
    
    const toolWrites = state._turnToolWrites || 0;
    console.log(`✅ [Execute] Complete: ${toolWrites} tool write(s), ${pendingToolCalls.length} tools${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);
    console.log(`   Telemetry: callIndex=${newCallIndex}, noOutputStreak=${state._noOutputCallCount || 0}, toolWrites=${toolWrites}`);

    // No-output streak tracker (feeds the advisory soft/hard warnings near
    // the top of this function; no longer a terminal gate — recursionLimit
    // is the ultimate backstop).
    //
    // Output signal: the just-run tool batch's successful artifact writes
    // (create_file/append_file/edit_file — `_turnToolWrites`, folded by the
    // tool node from sideEffects). Success-based on purpose: failed writes
    // must not register as output (outer-blending-prism / sharp-baking-bride).
    const hasNewFileOutput = toolWrites > 0;
    const hasToolCallsOnly = hasToolCalls && !hasNewFileOutput;
    const prevNoOutputCount = state._noOutputCallCount || 0;

    // Per-task artifact-write accumulator. `0` at completion = the model never
    // landed a successful artifact tool write this run; the completion
    // output-gate reads this to fail loud (design_no_output) instead of
    // reporting a phantom success. Reset to 0 on task boundary alongside
    // _noOutputCallCount/_executeCallIndex.
    const newTaskFilesWritten = (state._taskFilesWritten || 0) + toolWrites;

    // drainFinalizing MUST count toward the streak: once the strip persists
    // (drainFinalize.ts header) the tool node stops running, so without this
    // the counter freezes one margin below the cap and the router breaker is
    // never reached (round-grading-sable). See computeNextNoOutputCount.
    const newNoOutputCount = computeNextNoOutputCount(prevNoOutputCount, {
      hasNewFileOutput,
      hasToolCallsOnly,
      drainFinalizing,
    });

    // R5 — artifact-mutation-then-no-done detection is tool-channel-only:
    // successful writes fold into `_turnToolWrites` (tool node, success-based
    // sideEffects) and upgrade `_pendingDoneCheck` at the top of the NEXT
    // execute turn, so the trailing user message can ask the LLM whether the
    // assigned scope is satisfied. This turn therefore never sets the flag
    // itself; it only clears it when the LLM emits done. Escalation resets
    // whenever the flag is down. See `docs/internals/15-design-job.md`
    // "Codebase mutation gate".
    const nextPendingDoneCheck = false;
    const nextDoneCheckEscalation = 0;

    // Spec clarify detection via the shared gate (policy + budget + turn-
    // terminating). The matrix enables the `execute` phase only for `gen-spec`,
    // so this is spec-only by construction. Content-level clarify — asks about
    // spec document gaps within the committed intent, so NOT gated by
    // `isIntentCommitted`. Presentation is execute-specific (free-form bullet
    // list forwarded as a chat message, not choice cards), injected via `send`.
    {
      const clarifyIntent = state.resolvedAction?.intent as IntentId | undefined;
      const clarifyGate = clarifyIntent
        ? await applyClarifyGate({
            responseText: textResponse,
            intent: clarifyIntent,
            phase: 'execute',
            clarifyRoundsUsed: state.clarifyRoundsUsed,
            send: async (blocks) => {
              // execute's prompt uses the bare `<clarify>` body syntax (no
              // attribute); the parser stores the full body as `question`.
              const clarifyContent = blocks.map((b) => b.question).join('\n\n');
              await chatAPI.sendLLMEvent({ type: 'text', text: `\n\n**추가 정보가 필요합니다:**\n\n${clarifyContent}\n` });
              await chatAPI.finalizeMessage();
            },
          })
        : { paused: false as const, cleanedText: textResponse, blocks: [], stateUpdates: {} };
      if (clarifyGate.paused) {
        console.log(`💬 [Execute/Spec] clarify — pausing for user input`);

        await saveClarifyCheckpoint(state, { kind: 'execute', nodeHistory });

        // Clear estimating activity
        if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
          state.deps.kanbanUpdate.clearEstimatingActivity();
        }

        return {
          conversations: { [CONV_KEYS.NODE_EXECUTE]: nodeHistory },
          awaitingClarify: true,
          ...clarifyGate.stateUpdates,
          llmResponse: { textResponse, done: true },
          _executeCallIndex: newCallIndex,
          _noOutputCallCount: 0,
          _drainSalvageTools: null,
          _taskFilesWritten: newTaskFilesWritten,
          _turnToolWrites: 0,
          // Clarify pause is treated as a stable boundary — not an
          // artifact-mutation-without-done turn — so reset the gate.
          _pendingDoneCheck: false,
          _doneCheckEscalation: 0,
          _activePhase: 'execute' as const,
          _currentTaskTokenUsage: state._currentTaskTokenUsage,
          // Per-model twin — accumulateTokenUsage mutates it on the node's
          // state snapshot; a mutation is NOT a channel write, so omitting
          // it here dropped every parallel worker's per-model usage from
          // the checkpoint (oat-choosing-horse: 3 of 29 calls attributed).
          _currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel,
          tokenUsage: state.tokenUsage,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
        };
      }
    }

    // ── Join barrier (explore subagent): withhold <done> while reports are
    // owed. Router rule 3 (no tools + done=false) re-enters execute; the LLM
    // re-decides with the delivered reports. Runs whether or not this was a
    // drain-finalize turn — the redo turn re-passes applyDrainFinalization,
    // which re-strips tools and re-appends the note while a trigger holds.
    if (explicitDone && !hasToolCalls) {
      const subagentOwnerKey = ownerKeyFor(state._httpJobId);
      // No hasPending pre-gate — settled-but-undelivered reports must join too
      // (cyan-driving-apron E2E regression: pre-gate dropped settled reports).
      {
        const joined = await maybeJoinSubagents(state as any, subagentOwnerKey, { history: nodeHistory });
        if (joined) {
          const joinHistory = [
            ...nodeHistory,
            {
              role: 'user' as const,
              content: [
                ...joined.blocks,
                {
                  type: 'text' as const,
                  text: 'All pending subagent reports are delivered above. Incorporate them; if the document work is still complete as-is, output <done>true</done> again.',
                },
              ],
            },
          ];
          console.log(`🔀 [Execute] <done> withheld — subagent reports delivered, re-entering execute`);
          return {
            conversations: { [CONV_KEYS.NODE_EXECUTE]: joinHistory },
            _executeCallIndex: newCallIndex,
            _noOutputCallCount: newNoOutputCount,
            _drainSalvageTools: drainFinalizing ? (salvageTools ?? null) : null,
            _taskFilesWritten: newTaskFilesWritten,
            _turnToolWrites: 0,
            _pendingDoneCheck: false,
            _doneCheckEscalation: 0,
            _activePhase: 'execute' as const,
            _currentTaskTokenUsage: state._currentTaskTokenUsage,
            // Per-model twin (see the clarify return above). tokenDelta's
            // spread stays after this line on purpose — the subagent join
            // merges its own per-model delta on top.
            _currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel,
            tokenUsage: state.tokenUsage,
            recursionCount: state.recursionCount,
            recursionLimit: state.recursionLimit,
            llmResponse: { textResponse, done: false },
            ...(joined.tokenDelta as any),
            ...clarifyPatch,
          };
        }
      }
    }

    return {
      conversations: { [CONV_KEYS.NODE_EXECUTE]: nodeHistory },
      _executeCallIndex: newCallIndex,
      _noOutputCallCount: newNoOutputCount,
      // The salvage allow-list THIS round's LLM actually received — the tool
      // node's gateCall refuses calls outside it (drainSalvageGate.ts).
      _drainSalvageTools: drainFinalizing ? (salvageTools ?? null) : null,
      _taskFilesWritten: newTaskFilesWritten,
      // Consume-and-clear: the tool node's write count is per-batch.
      _turnToolWrites: 0,
      _pendingDoneCheck: nextPendingDoneCheck,
      _doneCheckEscalation: nextDoneCheckEscalation,
      // Phase signal for the tool node + breadcrumbs. Tool routing /
      // gate enforcement keys off `ToolExecutionContext.allowMutateInCodebase`
      // (codebase writes) and `ToolExecutionContext.allowShellExecution`
      // (run_command) in the handlers, not this flag — the field is
      // informational.
      _activePhase: 'execute' as const,
      _currentTaskTokenUsage: state._currentTaskTokenUsage,
      // Per-model twin — same mutation-is-not-a-channel-write rationale as
      // recursionCount below (oat-choosing-horse per-model attribution loss).
      _currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel,
      tokenUsage: state.tokenUsage,
      // recursionCount is a last-value channel: the mutation at the top of this
      // node is dropped unless returned here. Omitting it starved the
      // executeRouter drain guard (local-caring-board: gauge ~426 while real
      // super-steps hit 800, so `remaining < 30` never fired). Code-execute parity.
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
      llmResponse: hasToolCalls ? {
        toolCalls: pendingToolCalls,
        textResponse,
        thinking: thinking || undefined,
        thinkingSignature: thinkingSignature || undefined,
        done: false,
      } : {
        textResponse,
        done: explicitDone,
      },
      ...clarifyPatch,
    };
  } catch (error) {
    console.error('❌ [Execute] Error during reasoning:', error);
    throw error;
  }
}

/**
 * Calculate maxTokens based on task line budget
 */
function calculateMaxTokens(state: DesignGraphState): number {
  let maxTokens: number = LLM_MAX_TOKENS.DEFAULT;

  if (state.currentTask?.description) {
    const lineMatch = state.currentTask.description.match(/MAX (\d+) lines/i);
    if (lineMatch) {
      const maxLines = parseInt(lineMatch[1]);
      const estimatedTokens = maxLines * 12 + 3000;
      maxTokens = Math.max(maxTokens, estimatedTokens);
    }
  }

  return maxTokens;
}

/**
 * Build conversation history for resume
 * 
 * ✅ CRITICAL: When thinking is enabled, MUST include thinking blocks in conversation history
 * Reference: https://docs.claude.com/en/docs/build-with-claude/extended-thinking
 * 
 * "When thinking is enabled, a final assistant message must start with a thinking block
 * (preceeding the lastmost set of tool_use and tool_result blocks).
 * We recommend you include thinking blocks from previous turns."
 */
function buildNodeHistory(
  state: DesignGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
  thinkingContent: string,
  thinkingSig: string,
  textResponse: string,
  hasToolCalls: boolean,
  pendingToolCalls: Array<{ id: string; name: string; args: Record<string, any> }>,
): Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }> {
  let history: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>;
  const existingExecute = getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  
  if (existingExecute.length > 0) {
    history = [...existingExecute] as any;
  } else {
    history = [];
    for (const msg of messages) {
      history.push({
        role: msg.role,
        content: msg.content
      });
    }
  }
  
  if (hasToolCalls) {
    history.push(buildAssistantMessage({
      thinking: thinkingContent || undefined,
      thinkingSignature: thinkingSig || undefined,
      toolCalls: pendingToolCalls,
    }));
  } else {
    history.push(buildAssistantMessage({
      thinking: thinkingContent || undefined,
      thinkingSignature: thinkingSig || undefined,
      text: textResponse || undefined,
    }));
  }
  
  return history;
}

