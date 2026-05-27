/**
 * DocGen Node - 문서 생성 추론 (Design Job용 LLM)
 * 
 * 책임:
 * - LLM 호출 및 스트리밍
 * - XML 파싱 (<file> 태그로 Markdown 실시간 렌더링)
 * - Thinking/Text 수집
 * - Tool Call 감지 (실행은 하지 않음!)
 * 
 * 하지 않는 것:
 * - Tool 실행
 * - 파일 쓰기 (tool 노드가 담당)
 * - 루프 (LangGraph가 관리)
 * 
 * ✅ XML 파서 통합 for Markdown 실시간 렌더링
 * ✅ UI Design 모드 지원 (detectedIntentGroup === 'design-ui')
 *     - by-figma: Figma MCP 구조적 데이터 추출
 *     - by-desc: directive + PRD 기반 직접 작성
 *     - ui-tokens.json, ui-assets.json, ui-spec.json 생성
 */

import type { MessageContentBlock } from '../../../../../../core/ports/llm';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { DesignGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from '../../../../../common/graph/llmHelpers';
import { getTools } from './tools';
import { parseClarifyTags, consumeAwaitingClarify } from '../../../../../common/clarify';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { saveClarifyCheckpoint } from '../../session/checkpoint';
import { ARTIFACT_PREFIX, designDirOf } from '@ant/shared';

// ✅ Import prompt builders from sub-modules
import { buildMessages } from './intent/system';
import { buildUiDesignMessages } from './intent/ui';
import { buildSpecMessages } from './intent/spec';
import { renderExplainResponse } from './explain';

const CODEBASE_LIKE = (p: string): boolean => p === 'codebase' || p.startsWith('codebase/');
const ARTIFACT_MUTATE_TOOLS = new Set([
  'edit_file', 'delete_file', 'create_file', 'mkdir',
]);

/**
 * Detect "the LLM updated an artifact this turn" — for the
 * `_pendingDoneCheck` trigger (R5 of the codebase mutation gate plan).
 *
 * Counts both:
 *   - successful XML artifact-axis writes (file/append/edit/delete) on
 *     non-codebase paths (codebase paths never reach `files` because
 *     FileRenderer rejects them upstream),
 *   - pending tool-call mutations on non-codebase paths (edit_file /
 *     delete_file / create_file / mkdir).
 *
 * Returns `true` even when only tool calls are pending (without any
 * <file> output) so the next-turn self-check still fires after a
 * tool-only artifact-mutation turn (e.g. refactor mode `edit_file
 * architecture/spec/...`).
 */
function turnHadArtifactMutationIntent(
  files: Array<{ path: string }>,
  pendingToolCalls: Array<{ name: string; args?: any }>,
): boolean {
  const xmlMut = files.some(f => f.path && !CODEBASE_LIKE(f.path));
  const toolMut = pendingToolCalls.some(tc => {
    if (!ARTIFACT_MUTATE_TOOLS.has(tc.name)) return false;
    const p = tc.args?.path;
    return typeof p === 'string' && p.length > 0 && !CODEBASE_LIKE(p);
  });
  return xmlMut || toolMut;
}

export async function docGen(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Increment docGen call index (telemetry / displayed in warnings).
  // No longer a safety-net gate — runaway is bounded by LangGraph recursionLimit.
  const newCallIndex = (state._docGenCallIndex || 0) + 1;
  
  const llmClient = state.deps?.llm;
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
  console.log(`\n💭 [DocGen] Starting iteration ${newCallIndex} for task "${state.currentTask?.name || 'unknown'}"`);
  console.log(`   Intent group: ${intentGroup || 'unknown'}`);

  // Explain mode: chat-only response — no XML parsing, no disk artifact.
  // Branch BEFORE the intentGroup splits so the persisted-artifact templates
  // (system-design / design-spec / design-ui) never run for an explain task.
  if (isExplainMode) {
    state._docGenCallIndex = newCallIndex;
    console.log(`📝 [DocGen] explain mode — chat-only response, file write skipped`);
    return await renderExplainResponse(state);
  }
  const nodeDocGen = getConv(state.conversations, CONV_KEYS.NODE_DOCGEN);
  console.log(`   Conversation history: ${nodeDocGen.length} messages`);
  if (taskTokensSoFar?.totalTokens) {
    console.log(`   Task tokens so far: ${taskTokensSoFar.totalTokens} (in=${taskTokensSoFar.inputTokens} out=${taskTokensSoFar.outputTokens})`);
  }
  
  // ✅ Spec clarify continuation: append user's clarify response to NODE_DOCGEN
  // via the shared helper. Gated on `intentGroup === 'design-spec'` because
  // only spec clarify writes the docGen-kind checkpoint; other intent groups
  // never set `awaitingClarify` on this state.
  if (intentGroup === 'design-spec' && state.awaitingClarify && state.overrideDirective) {
    console.log(`📋 [DocGen/Spec] Clarify continuation — appending user response to conversation`);
    consumeAwaitingClarify(state, CONV_KEYS.NODE_DOCGEN);
  }
  
  let messages;
  let useSourceFileTool = false;

  if (intentGroup === 'design-ui') {
    messages = await buildUiDesignMessages(state);
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
  // docGen's role is "render the decision + verify a few exact paths" — so
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
        `You have been reading without producing output. Emit the <append>/<file> body using the conversation history — continued read-only calls just consume your turn budget without progress.`;
    } else if (noOutputCount >= softWarnAt) {
      warningText = `\n\n[no-output streak: ${noOutputCount} turns]\n` +
        `Begin writing the document body using <append>/<file> tags. Further reads are unlikely to add necessary information.`;
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
    console.log(`⚠️  [DocGen] No-output streak ${level}: ${noOutputCount} turns`);
  }

  // Tool activation: delegate to the per-node tools.ts selector so the
  // docGen node body stays focused on streaming / parsing.
  const tools = await getTools(state, { useSourceFileTool });
  
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
      state._httpJobId, 'docGen', state.workerId ?? 0, taskInfo,
      state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
      state.recursionCount, state.recursionLimit
    );
  }
  
  // ✅ Setup XML Parser + StreamOrchestrator
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git,  // ✅ Pass gitPort for immediate file writes
    state.deps?.fileSystem,  // ✅ Pass fileSystem for file operations
    !isExplainMode,  // ✅ writeImmediately gated by mode — explain returns earlier, this is defence-in-depth.
    'design',  // ✅ jobType: 'design' (for LAST_SECTION metadata handling)
    state.context.featurePath,  // ✅ Feature path for absolute path resolution
    undefined,  // ✅ Design job: no codebasePath
    state.deps?.fileTreeUpdate  // ✅ For real-time file tree updates via Redis Pub/Sub
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');

  // ✅ Pin the expected output filename for this task — guards against the
  // execute LLM emitting `<file path="...">` with a hallucinated filename
  // when the prompt is internally inconsistent (e.g. decompose mis-assigned
  // a foreign catalog's sections to this task). UI mode skipped because it
  // writes multiple artifacts per turn (ui-tokens.json, ui-assets.json,
  // ui-spec.json) rather than a single targetFile.
  if (intentGroup !== 'design-ui' && state.currentTask?.targetFile) {
    const targetFile = state.currentTask.targetFile;
    // Spec tasks (since the spec- prefix was dropped) ship an explicit
    // `targetDir`; other artifact kinds still derive their dir from the
    // filename prefix via designDirOf().
    const targetDir = state.currentTask.targetDir ?? designDirOf(targetFile);
    const expectedTargetFile = `${targetDir}/${targetFile}`;
    renderStrategy.setExpectedTargetFile(expectedTargetFile);
  }

  // ✅ Design job: Check actual disk files, not state.files (which accumulates across tasks)
  const existingFiles = await scanExistingFiles(state, intentGroup === 'design-ui');
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
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
  const isAfterToolCall = getConv(state.conversations, CONV_KEYS.NODE_DOCGEN).length > 0;
  
  try {
    // T1 pre-call estimate — covers every docGen round (continuation after
    // tool-result merges new messages into history).
    applyEstimatedInputTokensFromMessages(state, messages);
    // ✅ Stream with XML parsing + tool calling support
    // Thinking is always enabled; thinking blocks are preserved in conversation
    // history by the tool node so the API accepts them on subsequent turns.
    for await (const event of llmClient.stream(messages, {
      tools: tools && tools.length > 0 ? tools : undefined,
      maxTokens,
      enableThinking: true,
      thinkingBudget: LLM_THINKING_BUDGET.PLAN,
    })) {
      if (event.type === 'retry') {
        thinking = '';
        thinkingSignature = '';
        textResponse = '';
        capturedUsage = undefined;
        pendingToolCalls = [];
        continue;
      }

      maybeUpdatePhaseTokenUsage(state, event);

      // ✅ Pass to orchestrator for XML parsing (<file>, <append>, <edit>)
      await orchestrator.processEvent(event);
      
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
    
    // ✅ Wait for all file operations to complete BEFORE finalizing
    // (parity with code job execute/index.ts — detects incomplete <file> tags)
    try {
      await orchestrator.waitForAllFileOperations();
    } catch (fileError) {
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      console.error(`⚠️  [DocGen] File operation failed: ${errorMsg}`);
    }
    
    // ✅ Finalize orchestrator (flush buffer and save files)
    const hasToolCalls = pendingToolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);  // Don't flush if tool calls pending
    
    // ✅ CRITICAL: Extract file errors from finalize result for output validation
    const fileErrors = finalizeResult.fileErrors || [];
    if (fileErrors.length > 0) {
      console.error(`⚠️  [DocGen] ${fileErrors.length} file error(s) detected:`);
      for (const error of fileErrors) {
        console.error(`   - ${error.substring(0, 200)}`);
      }
    }
    
    // ✅ Get generated files from registry (in-memory tracking)
    const registry = orchestrator.getRegistry();
    const files = registry.getAllFiles();
    
    // Extract explicitDone from finalize result
    const explicitDone = finalizeResult.explicitDone || false;
    
    const nodeHistory = buildNodeHistory(state, messages, thinking, thinkingSignature, textResponse, hasToolCalls, pendingToolCalls);
    
    // Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage, logTokenUsageToFile, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: false });
      updateKanbanTokenUsage(state);
      
      const taskUsage = state._currentTaskTokenUsage;
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        capturedUsage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'docGen',
          callIndex: newCallIndex - 1,
          nodeHistoryLength: getConv(state.conversations, CONV_KEYS.NODE_DOCGEN).length,
          estimatedPromptChars: (messages as any[]).reduce((sum: number, m: any) => {
            if (typeof m.content === 'string') return sum + m.content.length;
            if (Array.isArray(m.content)) {
              return sum + m.content.reduce((s: number, b: any) =>
                s + (b.type === 'image' ? 200 : (typeof b.text === 'string' ? b.text.length : JSON.stringify(b).length)), 0);
            }
            return sum + JSON.stringify(m.content).length;
          }, 0),
          taskCumulativeInput: taskUsage?.inputTokens || 0,
          taskCumulativeOutput: taskUsage?.outputTokens || 0,
        }
      );
    }
    
    console.log(`✅ [DocGen] Complete: ${files.length} files, ${pendingToolCalls.length} tools${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);
    console.log(`   Telemetry: callIndex=${newCallIndex}, noOutputStreak=${state._noOutputCallCount || 0}, newFiles=${files.length}`);
    
    // No-output streak tracker (feeds the advisory soft/hard warnings near
    // the top of this function; no longer a terminal gate — recursionLimit
    // is the ultimate backstop).
    const hasNewFileOutput = files.length > 0;
    const hasToolCallsOnly = hasToolCalls && !hasNewFileOutput;
    const prevNoOutputCount = state._noOutputCallCount || 0;

    let newNoOutputCount = prevNoOutputCount;
    if (hasToolCallsOnly) {
      newNoOutputCount = prevNoOutputCount + 1;
    } else if (hasNewFileOutput) {
      newNoOutputCount = 0;
    }

    // R5 — artifact-mutation-then-no-done detection. When this turn
    // produced an artifact mutation (XML <file>/<append>/<edit>/<delete>
    // landing on an artifact path, or a pending edit_file/delete_file/
    // create_file/mkdir tool call on an artifact path) but the LLM did
    // NOT emit `<done>true</done>`, set the pending-done-check flag so
    // the next docGen turn's trailing user message can ask the LLM
    // whether the assigned scope is satisfied. Cleared on any turn that
    // either emits done or has no artifact mutation. See
    // `docs/architecture/15-design-job.md` "Codebase mutation gate".
    const turnArtifactMutated = turnHadArtifactMutationIntent(files, pendingToolCalls);
    const nextPendingDoneCheck = !explicitDone && turnArtifactMutated;
    const prevEscalation = state._doneCheckEscalation || 0;
    const nextDoneCheckEscalation = nextPendingDoneCheck ? prevEscalation + 1 : 0;

    // Spec clarify detection: if LLM response contains <clarify> tags, pause for user input.
    // Content-level clarify — asks about spec document gaps within the committed
    // design-spec intent, so NOT gated by `isIntentCommitted`.
    if (intentGroup === 'design-spec') {
      const clarifyBlocks = parseClarifyTags(textResponse);
      if (clarifyBlocks.length > 0) {
        console.log(`💬 [DocGen/Spec] Clarify block detected, pausing for user input`);

        // docGen's prompt uses the bare `<clarify>` body syntax (no attribute,
        // free-form bullet list). The parser stores the full body as `question`.
        const clarifyContent = clarifyBlocks.map(b => b.question).join('\n\n');

        // Send clarify content as a chat message
        await chatAPI.sendLLMEvent({ type: 'text', text: `\n\n**추가 정보가 필요합니다:**\n\n${clarifyContent}\n` });
        await chatAPI.finalizeMessage();
        
        await saveClarifyCheckpoint(state, { kind: 'docgen', nodeHistory });
        
        // Clear estimating activity
        if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
          state.deps.kanbanUpdate.clearEstimatingActivity();
        }
        
        return {
          files,
          conversations: { [CONV_KEYS.NODE_DOCGEN]: nodeHistory },
          awaitingClarify: true,
          llmResponse: { textResponse, done: true },
          _docGenCallIndex: newCallIndex,
          _noOutputCallCount: 0,
          // Clarify pause is treated as a stable boundary — not an
          // artifact-mutation-without-done turn — so reset the gate.
          _pendingDoneCheck: false,
          _doneCheckEscalation: 0,
          _activePhase: 'docGen' as const,
          _currentTaskTokenUsage: state._currentTaskTokenUsage,
          tokenUsage: state.tokenUsage,
        };
      }
    }

    return {
      files,
      conversations: { [CONV_KEYS.NODE_DOCGEN]: nodeHistory },
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
      _docGenCallIndex: newCallIndex,
      _noOutputCallCount: newNoOutputCount,
      _pendingDoneCheck: nextPendingDoneCheck,
      _doneCheckEscalation: nextDoneCheckEscalation,
      // Phase signal for the tool node + breadcrumbs. Tool routing /
      // gate enforcement keys off `ToolExecutionContext.allowMutateInCodebase`
      // (codebase writes) and `ToolExecutionContext.allowShellExecution`
      // (run_command) in the handlers, not this flag — the field is
      // informational.
      _activePhase: 'docGen' as const,
      _currentTaskTokenUsage: state._currentTaskTokenUsage,
      tokenUsage: state.tokenUsage,
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
    };
  } catch (error) {
    console.error('❌ [DocGen] Error during reasoning:', error);
    throw error;
  }
}

/**
 * Scan existing files on disk for the target directory
 */
async function scanExistingFiles(state: DesignGraphState, isUiDesign: boolean): Promise<Set<string>> {
  const existingFiles = new Set<string>();
  
  if (state.deps?.fileSystem && state.context.featurePath) {
    const path = await import('path');
    const rootPath = state.deps.fileSystem.getRootPath?.() || '';

    const scanDir = async (dirRel: string, prefix: string) => {
      try {
        if (!(await state.deps!.fileSystem!.fileExists(dirRel))) return;
        const entries = await state.deps!.fileSystem!.readDirectory(dirRel);
        for (const entry of entries) {
          if (!entry.isDirectory && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
            existingFiles.add(`${prefix}/${entry.name}`);
          }
        }
      } catch { /* continue */ }
    };

    const featureRel = rootPath
      ? path.relative(rootPath, state.context.featurePath)
      : state.context.featurePath.replace(/^\//, '');

    const visualUiAnt = ARTIFACT_PREFIX.UI_ANT.replace(/\/$/, '');
    const archSystem = ARTIFACT_PREFIX.SYSTEM_DESIGN.replace(/\/$/, '');
    const archSpec = ARTIFACT_PREFIX.SPEC.replace(/\/$/, '');

    await scanDir(path.join(featureRel, visualUiAnt), visualUiAnt);
    await scanDir(path.join(featureRel, archSystem), archSystem);
    await scanDir(path.join(featureRel, archSpec), archSpec);
  }
  
  return existingFiles;
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
  const existingDocGen = getConv(state.conversations, CONV_KEYS.NODE_DOCGEN);
  
  if (existingDocGen.length > 0) {
    history = [...existingDocGen] as any;
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

