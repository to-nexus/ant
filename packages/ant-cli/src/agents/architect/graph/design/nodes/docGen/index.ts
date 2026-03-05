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
 * ✅ UI Design 모드 지원 (designWorkType === 'ui-design')
 *     - 멀티모달 이미지 분석 (레퍼런스 스크린샷)
 *     - ui-tokens.json, ui-assets.json, ui-spec.json 생성
 */

import { DesignGraphState } from '../../state';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { getToolsByNames, TOOL_SETS } from '../../../../tools/definitions';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import { READ_SOURCE_DOC_TOOL } from './sourceSelector';

// ✅ Import prompt builders from sub-modules
import { buildMessages } from './systemDesignPrompt';
import { buildUiDesignMessages } from './uiDesignPrompt';
import { buildSpecMessages } from './specPrompt';

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
  
  // ✅ Log iteration start info (per-call debugging, like code job's codeGen)
  const taskTokensSoFar = (state as any)._currentTaskTokenUsage;
  console.log(`\n💭 [DocGen] Starting iteration ${newCallIndex} for task "${state.currentTask?.name || 'unknown'}"`);
  console.log(`   Work type: ${state.detectionReport?.workType || 'unknown'}`);
  console.log(`   Conversation history: ${state.conversationHistory?.length || 0} messages`);
  if (taskTokensSoFar?.totalTokens) {
    console.log(`   Task tokens so far: ${taskTokensSoFar.totalTokens} (in=${taskTokensSoFar.inputTokens} out=${taskTokensSoFar.outputTokens})`);
  }
  
  // ✅ Build messages based on work type
  const workType = state.detectionReport?.workType;
  const isExplainMode = state.detectionReport?.jobMode === 'explain';
  
  // ✅ Spec clarify continuation: append user's clarify response to conversation history
  if (workType === 'spec' && state.awaitingClarify && state.overrideDirective) {
    console.log(`📋 [DocGen/Spec] Clarify continuation — appending user response to conversation`);
    if (!state.conversationHistory) state.conversationHistory = [];
    state.conversationHistory.push({
      role: 'user',
      content: state.overrideDirective,
    });
    state.awaitingClarify = false;
  }
  
  let messages;
  let useSourceFileTool = false;

  if (workType === 'ui-design') {
    messages = await buildUiDesignMessages(state);
  } else if (workType === 'spec') {
    messages = await buildSpecMessages(state);
  } else {
    const result = await buildMessages(state);
    messages = result.messages;
    useSourceFileTool = result.useSourceFileTool;
  }
  
  // Tool activation: Select appropriate tool set based on work type
  const tools = isExplainMode
    ? getToolsByNames(TOOL_SETS.designExplain)
    : workType === 'ui-design'
      ? getToolsByNames(TOOL_SETS.uiDesign)
      : useSourceFileTool
        ? [...getToolsByNames(TOOL_SETS.design), READ_SOURCE_DOC_TOOL]
        : getToolsByNames(TOOL_SETS.design);
  
  // Tool configuration complete
  
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
      state._httpJobId, 'docGen', (state as any).workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
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
  
  // ✅ Design job: Check actual disk files, not state.files (which accumulates across tasks)
  const existingFiles = await scanExistingFiles(state, workType === 'ui-design');
  
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
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  
  try {
    // ✅ Stream with XML parsing + tool calling support
    // Thinking is always enabled; thinking blocks are preserved in conversation
    // history by the tool node so the API accepts them on subsequent turns.
    for await (const event of llmClient.stream(messages, {
      tools: tools && tools.length > 0 ? tools : undefined,
      maxTokens,
      enableThinking: true,
      thinkingBudget: LLM_THINKING_BUDGET.PLAN,
    })) {
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
    
    // ✅ Finalize orchestrator (flush buffer and save files)
    const hasToolCalls = pendingToolCalls.length > 0;
    const finalizeResult = await orchestrator.finalize(hasToolCalls);  // Don't flush if tool calls pending
    
    // ✅ Get generated files from registry (in-memory tracking)
    const registry = orchestrator.getRegistry();
    const files = registry.getAllFiles();
    
    // Extract explicitDone from finalize result
    const explicitDone = finalizeResult.explicitDone || false;
    
    // Build conversation history for resume
    const conversationHistory = buildConversationHistory(state, messages, thinking, thinkingSignature, textResponse, hasToolCalls);
    
    // Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage, logTokenUsageToFile, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: false });
      updateKanbanTokenUsage(state as any);
      
      const taskUsage = (state as any)._currentTaskTokenUsage;
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        capturedUsage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'docGen',
          callIndex: newCallIndex - 1,
          conversationHistoryLength: state.conversationHistory?.length || 0,
          estimatedPromptChars: (messages as any[]).reduce((sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0),
          taskCumulativeInput: taskUsage?.inputTokens || 0,
          taskCumulativeOutput: taskUsage?.outputTokens || 0,
        }
      );
    }
    
    console.log(`✅ [DocGen] Complete: ${files.length} files, ${pendingToolCalls.length} tools${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);
    
    // ✅ Spec clarify detection: if LLM response contains <clarify> tags, pause for user input
    if (workType === 'spec' && textResponse.includes('<clarify>')) {
      const clarifyMatch = textResponse.match(/<clarify>([\s\S]*?)<\/clarify>/);
      if (clarifyMatch) {
        console.log(`💬 [DocGen/Spec] Clarify block detected, pausing for user input`);
        
        const clarifyContent = clarifyMatch[1].trim();
        
        // Send clarify content as a chat message
        await chatAPI.sendLLMEvent({ type: 'text', text: `\n\n**추가 정보가 필요합니다:**\n\n${clarifyContent}\n` });
        await chatAPI.finalizeMessage();
        
        // Save awaitingClarify + conversation history to session for resume
        if (state.deps?.session && state.context.featureFolder) {
          try {
            await state.deps.session.updateArtifacts(
              state.context.project,
              state.context.featureFolder,
              'design',
              {
                state: {
                  awaitingClarify: true,
                  conversationHistory,
                  detectionReport: state.detectionReport,
                  directive: state.directive,
                  overrideDirective: state.overrideDirective,
                  chatSource: state.chatSource,
                }
              }
            );
            console.log(`💾 [DocGen/Spec] Saved awaitingClarify=true to session`);
          } catch (err) {
            console.warn(`⚠️  [DocGen/Spec] Failed to save clarify state:`, err);
          }
        }
        
        // Clear estimating activity
        if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
          state.deps.kanbanUpdate.clearEstimatingActivity();
        }
        
        return {
          files,
          conversationHistory,
          awaitingClarify: true,
          llmResponse: { textResponse, done: true },
          _docGenCallIndex: newCallIndex,
          _currentTaskTokenUsage: (state as any)._currentTaskTokenUsage,
          tokenUsage: (state as any).tokenUsage,
        };
      }
    }
    
    return {
      files,
      conversationHistory,
      _docGenCallIndex: newCallIndex,
      _currentTaskTokenUsage: (state as any)._currentTaskTokenUsage,
      tokenUsage: (state as any).tokenUsage,
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
    
    // Determine target directory based on work type
    const targetDir = 'outputs/design';
    const designDirAbs = path.join(state.context.featurePath, targetDir);
    
    // ✅ Convert to workspace-relative path for fileSystem port
    const rootPath = state.deps.fileSystem.getRootPath?.() || '';
    const designDirRel = rootPath
      ? path.relative(rootPath, designDirAbs)
      : designDirAbs.replace(/^\//, '');
    
    try {
      // Check if directory exists using workspace-relative path
      const dirExists = await state.deps.fileSystem.fileExists(designDirRel);
      if (dirExists) {
        // Read directory contents using workspace-relative path
        const entries = await state.deps.fileSystem.readDirectory(designDirRel);
        
        // Add all design files to existingFiles (relative to feature path)
        // Support: .json (ui-tokens, ui-assets, ui-spec)
        for (const entry of entries) {
          if (!entry.isDirectory && 
              (entry.name.endsWith('.md') || 
               entry.name.endsWith('.json'))) {
            const relativePath = `${targetDir}/${entry.name}`;
            existingFiles.add(relativePath);
          }
        }
        
      }
    } catch (error) {
      // Continue with empty existingFiles set
    }
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
function buildConversationHistory(
  state: DesignGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
  thinkingContent: string,
  thinkingSig: string,
  textResponse: string,
  hasToolCalls: boolean
): Array<{ role: 'user' | 'assistant'; content: string | any[] }> {
  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string | any[] }>;
  
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    // ✅ Tool loop: Extend existing history
    conversationHistory = [...state.conversationHistory];
  } else {
    // ✅ Fresh start: Build from messages
    conversationHistory = [];
    for (const msg of messages) {
      conversationHistory.push({
        role: msg.role,
        content: msg.content
      });
    }
  }
  
  // ✅ Add assistant's response with thinking block (if present)
  // CRITICAL: When thinking is enabled, assistant message MUST start with thinking block
  if (!hasToolCalls) {
    const assistantContent: any[] = [];
    
    // ✅ Add thinking block first (if present)
    // signature is required by Anthropic API for multi-turn conversations
    if (thinkingContent) {
      assistantContent.push({
        type: 'thinking',
        thinking: thinkingContent,
        signature: thinkingSig || '',
      });
    }
    
    // ✅ Add text response
    if (textResponse) {
      assistantContent.push({
        type: 'text',
        text: textResponse
      });
    }
    
    conversationHistory.push({
      role: 'assistant',
      content: assistantContent.length === 1 && assistantContent[0].type === 'text'
        ? textResponse  // Simple text-only response (no thinking)
        : assistantContent  // Array with thinking + text
    });
  }
  // NOTE: When hasToolCalls=true, don't add to history here.
  // tool.ts will add the complete tool_use + tool_result sequence.
  
  return conversationHistory;
}

