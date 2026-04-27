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

// ✅ Import prompt builders from sub-modules
import { buildMessages } from './intent/system';
import { buildUiDesignMessages } from './intent/ui';
import { buildSpecMessages } from './intent/spec';

const MAX_NO_OUTPUT_CALLS = 15;

export async function docGen(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Increment docGen call index (for call budget safety net)
  const newCallIndex = (state._docGenCallIndex || 0) + 1;
  
  const llmClient = state.deps?.llm;
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ Build messages based on intent group
  const intentGroup = state.resolvedAction?.intentGroup;
  const isExplainMode = state.resolvedAction?.mode === 'explain';

  // ✅ Log iteration start info (per-call debugging, like code job's execute)
  const taskTokensSoFar = state._currentTaskTokenUsage;
  console.log(`\n💭 [DocGen] Starting iteration ${newCallIndex} for task "${state.currentTask?.name || 'unknown'}"`);
  console.log(`   Intent group: ${intentGroup || 'unknown'}`);
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

  // Progressive call counter + budget warning injection
  // Figma tasks get higher thresholds to accommodate drill-down queries
  const hasFigmaTools = isFigmaUiDesign || (intentGroup === 'design-spec' && state.figmaAvailable === true);
  const softWarnAt = hasFigmaTools ? 8 : 5;
  const hardWarnAt = hasFigmaTools ? 12 : 8;
  const noOutputCount = state._noOutputCallCount || 0;
  if (noOutputCount >= 1) {
    const remaining = MAX_NO_OUTPUT_CALLS - noOutputCount;
    let warningText: string;
    if (noOutputCount >= hardWarnAt) {
      warningText = `\n\n⚠️ SYSTEM WARNING [call budget: ${noOutputCount}/${MAX_NO_OUTPUT_CALLS} tool-only calls, ${remaining} remaining]\n` +
        `STOP all reading. You MUST write your document NOW using <file> or <append> tags, or this task will be TERMINATED. ` +
        `Use the information already in your conversation history.`;
    } else if (noOutputCount >= softWarnAt) {
      warningText = `\n\n⚠️ WARNING [call budget: ${noOutputCount}/${MAX_NO_OUTPUT_CALLS} tool-only calls]\n` +
        `You MUST start writing your document NOW. You have gathered enough context from source documents. ` +
        `Do NOT read more — begin output immediately using <file> or <append> tags.`;
    } else {
      warningText = `\n\n[call budget: ${noOutputCount}/${MAX_NO_OUTPUT_CALLS} tool-only calls]\n` +
        `Reminder: you MUST start writing output by call ${softWarnAt}-${softWarnAt + 2}. Read in broad ranges (300-500+ lines) and do not exhaustively read every section.`;
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
    console.log(`⚠️  [DocGen] Budget ${level}: ${noOutputCount}/${MAX_NO_OUTPUT_CALLS} no-output calls, ${remaining} remaining`);
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
    true,  // ✅ writeImmediately: true (design job now writes files immediately like code job)
    'design',  // ✅ jobType: 'design' (for LAST_SECTION metadata handling)
    state.context.featurePath,  // ✅ Feature path for absolute path resolution
    undefined,  // ✅ Design job: no codebasePath
    state.deps?.fileTreeUpdate  // ✅ For real-time file tree updates via Redis Pub/Sub
  );
  renderStrategy.setParallelTaskName(state.currentTask?.name || 'Task');
  
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
    console.log(`   SafetyNet: callIndex=${newCallIndex}, noOutputStreak=${state._noOutputCallCount || 0}, newFiles=${files.length}`);
    
    // Safety Net state calculation (MUST go through channel system via return value)
    const envMaxCalls = parseInt(process.env.DOCGEN_MAX_CALLS || '', 10);
    const maxCalls = (!isNaN(envMaxCalls) && envMaxCalls >= 10) ? envMaxCalls : 25;

    const hasNewFileOutput = files.length > 0;
    const hasToolCallsOnly = hasToolCalls && !hasNewFileOutput;
    const prevNoOutputCount = state._noOutputCallCount || 0;

    let newNoOutputCount = prevNoOutputCount;
    if (hasToolCallsOnly) {
      newNoOutputCount = prevNoOutputCount + 1;
    } else if (hasNewFileOutput) {
      newNoOutputCount = 0;
    }

    const callLimitReached = newCallIndex >= maxCalls || newNoOutputCount >= MAX_NO_OUTPUT_CALLS;

    if (callLimitReached) {
      const reason = newCallIndex >= maxCalls
        ? `call budget exhausted (${newCallIndex}/${maxCalls})`
        : `non-productive loop (${newNoOutputCount} consecutive tool-only calls)`;
      console.warn(`⚠️  [DocGen] Safety net triggered: ${reason}`);
    }

    const warningThreshold = Math.floor(maxCalls * 0.8);
    if (newCallIndex === warningThreshold) {
      console.warn(`⚠️  [DocGen] Approaching call limit (${newCallIndex}/${maxCalls}) — ${maxCalls - newCallIndex} calls remaining`);
    }

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
          _callLimitReached: false,
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
      _callLimitReached: callLimitReached,
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

    const designDirAbs = path.join(state.context.featurePath, 'outputs/design');
    const designDirRel = rootPath
      ? path.relative(rootPath, designDirAbs)
      : designDirAbs.replace(/^\//, '');

    await scanDir(path.join(designDirRel, 'ui', 'ant'), 'outputs/design/ui/ant');
    await scanDir(path.join(designDirRel, 'system'), 'outputs/design/system');
    await scanDir(path.join(designDirRel, 'spec'), 'outputs/design/spec');
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

