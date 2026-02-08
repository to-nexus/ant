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

// ✅ Import prompt builders from sub-modules
import { buildMessages } from './systemDesignPrompt';
import { buildUiDesignMessages } from './uiDesignPrompt';

export async function docGen(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  const llmClient = state.deps?.llm;
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ Build messages based on work type
  const isUiDesign = state.detectionReport?.workType === 'ui-design';
  const isExplainMode = state.detectionReport?.jobMode === 'explain';
  
  const messages = isUiDesign 
    ? await buildUiDesignMessages(state)
    : await buildMessages(state);
  
  // Tool activation: Select appropriate tool set based on work type
  const tools = isExplainMode
    ? undefined
    : isUiDesign
      ? getToolsByNames(TOOL_SETS.uiDesign)
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
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'docGen', taskInfo);
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
    state.context.featurePath  // ✅ Feature path for absolute path resolution
  );
  
  // ✅ Design job: Check actual disk files, not state.files (which accumulates across tasks)
  const existingFiles = await scanExistingFiles(state, isUiDesign);
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
  });
  
  // ✅ Collect LLM output
  let thinking = '';
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
    // ✅ CRITICAL: Thinking control pattern (same as Code Job)
    // - First call (no conversation history): thinking=true (LLM needs to plan)
    // - After tool call (conversation history exists): thinking=false (Anthropic API requirement)
    // Context: Anthropic requires thinking blocks only on FIRST assistant message in a conversation turn.
    // After tool_use, the next assistant message should NOT have thinking (API rejects it).
    for await (const event of llmClient.stream(messages, {
      tools: tools && tools.length > 0 ? tools : undefined,
      maxTokens,
      enableThinking: !isAfterToolCall,  // ✅ Disable thinking after tool calls (Anthropic API requirement)
    })) {
      // ✅ Pass to orchestrator for XML parsing (<file>, <append>, <edit>)
      await orchestrator.processEvent(event);
      
      // Thinking
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
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
        const { extractTokenUsageFromStreamEvent } = await import('../../../common/llmHelpers');
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
    const conversationHistory = buildConversationHistory(state, messages, thinking, textResponse, hasToolCalls);
    
    // Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage } = await import('../../../common/llmHelpers');
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
    }
    
    console.log(`✅ [DocGen] Complete: ${files.length} files, ${pendingToolCalls.length} tools${capturedUsage ? `, ${capturedUsage.totalTokens} tokens` : ''}`);
    
    return {
      files,
      conversationHistory,
      // ✅ Return tool calls for routing decision
      // CRITICAL: Only mark done if LLM explicitly output <done>true</done> (same as Code Job)
      llmResponse: hasToolCalls ? {
        toolCalls: pendingToolCalls,
        textResponse,
        done: false,
      } : {
        textResponse,
        done: explicitDone,  // ✅ Only done when LLM explicitly says so
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
    const workspaceRoot = state.deps.fileSystem.getWorkspaceRoot?.() || '';
    const designDirRel = workspaceRoot
      ? path.relative(workspaceRoot, designDirAbs)
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
  // ✅ Use 16K like Code Job (works even with Sonnet 8K - provider handles capping)
  let maxTokens = 16000;

  if (state.currentTask?.description) {
    const lineMatch = state.currentTask.description.match(/MAX (\d+) lines/i);
    if (lineMatch) {
      const maxLines = parseInt(lineMatch[1]);
      // Estimate: ~12 tokens per line (average for Markdown with formatting)
      // Add 3000 tokens buffer for XML tags, metadata, and thinking
      const estimatedTokens = maxLines * 12 + 3000;

      // Smart minimum based on complexity
      const minTokens = maxLines <= 150 ? 12000 : 16000;
      maxTokens = Math.max(minTokens, estimatedTokens);
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
    if (thinkingContent) {
      assistantContent.push({
        type: 'thinking',
        thinking: thinkingContent
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

