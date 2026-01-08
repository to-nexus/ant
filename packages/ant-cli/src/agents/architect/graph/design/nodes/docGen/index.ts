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
 *     - ui-tokens.md, ui-assets.md, ui-spec.md 생성
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
  console.log('\n📝 [DocGen] Starting document generation...\n');
  
  const llmClient = state.deps?.llm;
  const gitPort = state.deps?.git;
  if (!llmClient || !gitPort) {
    throw new Error('LLM client or GitPort not available');
  }
  
  // ✅ Build messages based on work type
  const isUiDesign = state.designWorkType === 'ui-design';
  const messages = isUiDesign 
    ? await buildUiDesignMessages(state)
    : await buildMessages(state);
  
  // ✅ Tool activation: Select appropriate tool set based on work type
  const tools = isUiDesign
    ? getToolsByNames(TOOL_SETS.uiDesign)
    : getToolsByNames(TOOL_SETS.design);
  
  console.log(`📝 [DocGen] ${isUiDesign ? 'UI Design' : 'System Design'} mode - ${tools.length} tools available`);
  
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
    // ✅ CRITICAL: Disable thinking after tool calls (Anthropic API requirement)
    for await (const event of llmClient.stream(messages, {
      tools: tools.length > 0 ? tools : undefined,
      maxTokens,
      enableThinking: !isAfterToolCall,  // ✅ Disable after tool calls (Code job pattern)
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
          console.log(`🔧 [DocGen] Tool call detected: ${toolEvent.toolUse.name}`);
        } else {
          console.warn(`⚠️  [DocGen] tool_use event missing toolUse property:`, JSON.stringify(event));
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
    await orchestrator.finalize(hasToolCalls);  // Don't flush if tool calls pending
    
    // ✅ Get generated files from registry (in-memory tracking)
    const registry = orchestrator.getRegistry();
    const files = registry.getAllFiles();
    
    console.log(`\n✅ [DocGen] XML streaming complete (${files.length} files generated, ${pendingToolCalls.length} tool calls pending)`);
    
    // ✅ Build conversation history for resume
    const conversationHistory = buildConversationHistory(state, messages, textResponse, hasToolCalls);
    
    console.log(`📝 [DocGen] Conversation history updated (${conversationHistory.length} messages)`);
    
    // ✅ Accumulate token usage to state
    if (capturedUsage) {
      const { accumulateTokenUsage } = await import('../../../common/llmHelpers');
      accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
      
      console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
      if (capturedUsage.cacheReadTokens) {
        console.log(`   Cache read: ${capturedUsage.cacheReadTokens} tokens`);
      }
      if (capturedUsage.cacheCreationTokens) {
        console.log(`   Cache creation: ${capturedUsage.cacheCreationTokens} tokens`);
      }
    }
    
    return {
      files,
      conversationHistory,
      // ✅ Return tool calls for routing decision
      llmResponse: hasToolCalls ? {
        toolCalls: pendingToolCalls,
        textResponse,
        done: false,
      } : {
        textResponse,
        done: true,
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
        
        // Add all .md files to existingFiles (relative to feature path)
        for (const entry of entries) {
          if (!entry.isDirectory && entry.name.endsWith('.md')) {
            const relativePath = `${targetDir}/${entry.name}`;
            existingFiles.add(relativePath);
          }
        }
        
        console.log(`📋 [DocGen] Existing files on disk: ${existingFiles.size > 0 ? Array.from(existingFiles).join(', ') : 'none'}`);
      } else {
        console.log(`📋 [DocGen] ${targetDir} directory does not exist yet (first task)`);
      }
    } catch (error) {
      console.warn(`⚠️  [DocGen] Failed to scan ${targetDir} directory:`, error);
      // Continue with empty existingFiles set
    }
  }
  
  return existingFiles;
}

/**
 * Calculate maxTokens based on task line budget
 */
function calculateMaxTokens(state: DesignGraphState): number {
  let maxTokens = 16000;
  
  if (state.currentTask?.description) {
    const lineMatch = state.currentTask.description.match(/MAX (\d+) lines/i);
    if (lineMatch) {
      const maxLines = parseInt(lineMatch[1]);
      // Estimate: ~12 tokens per line (average for Markdown with formatting)
      // Add 3000 tokens buffer for XML tags, metadata, and thinking
      const estimatedTokens = maxLines * 12 + 3000;
      
      // ✅ Smart minimum based on complexity
      const minTokens = maxLines <= 150 ? 16000 : 20000;
      maxTokens = Math.max(minTokens, estimatedTokens);
      
      console.log(`📏 [DocGen] Task line budget: ${maxLines} lines → maxTokens: ${maxTokens} (min: ${minTokens})`);
    }
  }
  
  return maxTokens;
}

/**
 * Build conversation history for resume
 */
function buildConversationHistory(
  state: DesignGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: any }>,
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
  
  // ✅ Add assistant's response (text only, NOT tool calls)
  // CRITICAL: Follow Code job pattern - tool_use is added by tool.ts, not here!
  if (!hasToolCalls) {
    conversationHistory.push({
      role: 'assistant',
      content: textResponse
    });
  }
  // NOTE: When hasToolCalls=true, don't add to history here.
  // tool.ts will add the complete tool_use + tool_result sequence.
  
  return conversationHistory;
}

