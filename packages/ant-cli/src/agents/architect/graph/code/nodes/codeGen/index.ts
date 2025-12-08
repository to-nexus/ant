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

import { ArchitectGraphState } from '../../state';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { StreamBufferManager } from '../../../../../../core/streaming/buffer/StreamBufferManager';

// Import submodules
import { buildMessages } from './promptBuilder';
import { getAvailableTools } from './toolDefinitions';

export async function codeGen(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n💭 [CodeGen] Starting reasoning...\n');
  
  const llmClient = state.deps?.llm;
  if (!llmClient) {
    throw new Error('LLM client not available');
  }
  
  // ✅ Build messages from conversation history + current task
  const messages = await buildMessages(state);
  
  // ✅ Tool activation control
  // - Explain mode: NO tools (just explanation)
  // - Design job: NO tools (XML streaming)
  // - Code job (generate/refactor): YES tools
  const isExplainMode = state.codeMode === 'explain';
  const enableTools = state.codeMode !== undefined && !isExplainMode;
  const tools = enableTools ? getAvailableTools(state) : undefined;
  
  if (isExplainMode) {
    console.log(`💡 [CodeGen] Explain mode - tools disabled (explanation only)`);
  } else if (enableTools) {
    console.log(`🔧 [CodeGen] Tool calling enabled (code job)`);
  } else {
    console.log(`📝 [CodeGen] Tool calling disabled (design job or other)`);
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
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ UI streaming
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Initialize BufferManager for MD file streaming (if not exists)
  if (!state._bufferManager) {
    // ✅ Code job: Working dir = codebase, Buffer dir = features/{feature}/.buffers
    const featurePath = state.context?.featurePath;
    if (!featurePath || typeof featurePath !== 'string') {
      console.error('[CodeGen] featurePath not available or not a string:', featurePath);
      throw new Error('[CodeGen] featurePath is required for buffer initialization');
    }
    
    // Extract project root from featurePath
    // Example: workspaces/to.nexus/probe/ant-landing/features/skeleton
    // Project root: workspaces/to.nexus/probe/ant-landing
    const projectPath = featurePath.replace(/\/features\/[^/]+$/, '');
    
    // ✅ Validate projectPath
    if (!projectPath || projectPath === featurePath) {
      console.error('[CodeGen] Failed to extract project root from featurePath:', featurePath);
      throw new Error('[CodeGen] Invalid featurePath format');
    }
    
    const featureName = state.context.featureFolder || 'default';
    const jobId = state._httpJobId || 'unknown';
    
    console.log(`📦 [CodeGen] Initializing BufferManager:`, {
      projectPath,
      featureName,
      jobId,
    });
    
    state._bufferManager = new StreamBufferManager(projectPath, featureName, 'code', jobId);
    console.log(`📦 [CodeGen] BufferManager initialized`);
  }
  
  // ✅ Setup XML Parser + StreamOrchestrator for MD file streaming
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state._bufferManager,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git  // ✅ Pass gitPort for actual file editing
  );
  
  const existingFiles = new Set(state.files?.map((f: any) => f.path) || []);
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
  });
  
  // Collect LLM output
  let thinking = '';
  let textResponse = '';
  const toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }> = [];
  
  // ✅ Check if this is a continuation after tool calling
  const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
  
  try {
    // ✅ Single stream (no loop!)
    for await (const event of llmClient.stream(messages, {
      tools,
      maxTokens: 16000,
      enableThinking: !isAfterToolCall,  // ✅ Disable thinking after tool call
    })) {
      // ✅ Pass to orchestrator for XML parsing (MD file streaming)
      await orchestrator.processEvent(event);
      
      // Thinking (UI only - NOT included in conversation history!)
      if (event.type === 'thinking') {
        thinking += event.thinking || '';  // ✅ For UI display only
        // Don't send directly - orchestrator handles it
      }
      
      // Text
      if (event.type === 'text') {
        textResponse += event.text || '';  // ✅ NEW: text 필드 사용
        // Don't send directly - orchestrator handles it
      }
      
      // Tool call (감지만, 실행 안함!)
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        // 🎯 CRITICAL: Only send FIRST tool call to UI (Standard Tool Calling pattern)
        // Other tool calls are collected but not shown to user (they'll be dropped by tool node)
        if (toolCalls.length === 0) {
          await chatAPI.sendLLMEvent(event);
        }
        
        toolCalls.push({
          id,
          name,
          args: input,
        });
      }
      
      // Done
      if (event.type === 'done') {
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Finalize orchestrator (flush buffer)
    // Pass hasToolCalls flag to prevent premature message finalization
    const hasToolCalls = toolCalls.length > 0;
    await orchestrator.finalize(hasToolCalls);
    
    console.log(`\n✅ [CodeGen] Reasoning complete`);
    console.log(`   Thinking: ${thinking.length} chars`);
    console.log(`   Text: ${textResponse.length} chars`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    
    // ✅ Explain mode validation
    if (isExplainMode && toolCalls.length > 0) {
      console.error('⚠️  [CodeGen] Explain mode should NOT use tools!');
      console.error('   Tool calls detected:', toolCalls.map(t => t.name).join(', '));
      throw new Error('[CodeGen] Explain mode should not generate tool calls. Response must be pure text explanation.');
    }
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen');  // ✅ FIX: Must match graph.addNode() name!
    }
    
    // ✅ Return LLM response (state에 저장)
    // 🔴 FIX: done should be false if there are tool calls (LLM is NOT done yet!)
    return {
      llmResponse: {
        thinking,         // ✅ For UI display only (not in conversation history)
        textResponse,     // ✅ For conversation history (if no tool calls)
        toolCalls,        // ✅ For tool execution
        done: toolCalls.length === 0,  // ✅ Tool calls 없을 때만 done = true
      },
      _bufferManager: state._bufferManager,  // ✅ Preserve buffer manager
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
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'codeGen');  // ✅ FIX: Must match graph.addNode() name!
    }
    
    throw error;
  }
}

