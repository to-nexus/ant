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

// Import submodules
import { buildMessages } from './promptBuilder';
import { getAvailableTools } from './toolDefinitions';

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
  
  // ✅ NEW: Select model based on current TASK type and priority
  let llmToUse = llmClient;
  if (state.workspaceConfig && state.currentTask) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
    
    // Determine model based on TASK type (not node type!)
    // All nodes processing this task will use the same model
    let taskType: 'error' | 'final' | 'setup' | 'default' = 'default';
    
    if (state.currentTask.type === 'error') {
      taskType = 'error';
    } else if (state.currentTask.type === 'setup') {
      taskType = 'setup';
    } else if (state.currentTask.type === 'feature' && state.currentTask.priority === 1000) {
      taskType = 'final';
    }
    
    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', taskType },  // ✅ Pass taskType, not nodeType!
      state.workspaceConfig
    );
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
  
  // ✅ Setup XML Parser + StreamOrchestrator for MD file streaming
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.context.userLanguage,  // ✅ Pass user language for localized messages
    state.deps?.git,  // ✅ Pass gitPort for actual file editing
    true,  // ✅ writeImmediately: true for code job (no separate writeFiles node)
    'code',  // ✅ jobType: 'code' (no LAST_SECTION handling needed)
    undefined  // ✅ Code job: no featurePath (uses codebase as working directory)
  );
  
  // ✅ Code job: Build existingFiles from projectCodeContext + referenceCodeContexts
  // These contain the actual codebase files loaded by the plan node
  // This prevents LLM from accidentally using <file> on existing files
  const existingFiles = new Set<string>();
  
  // ✅ CRITICAL: Use filePaths instead of files array
  // - files array may be empty (content not saved to session for memory optimization)
  // - filePaths array always contains the list of known files
  if (state.projectCodeContext?.filePaths) {
    for (const filePath of state.projectCodeContext.filePaths) {
      if (filePath) {
        existingFiles.add(filePath);
      }
    }
  }
  
  // ✅ FALLBACK: Also add files from files array if available (for backward compatibility)
  if (state.projectCodeContext?.files) {
    for (const file of state.projectCodeContext.files) {
      if (file.path) {
        existingFiles.add(file.path);
      }
    }
  }
  
  // Add files from referenceCodeContexts
  if (state.referenceCodeContexts) {
    for (const refContext of state.referenceCodeContexts) {
      if (refContext?.files) {
        for (const file of refContext.files) {
          if (file.path) {
            existingFiles.add(file.path);
          }
        }
      }
    }
  }
  
  console.log(`🔍 [CodeGen] existingFiles Set initialized with ${existingFiles.size} files from projectCodeContext`);
  if (existingFiles.size > 0 && existingFiles.size <= 10) {
    console.log(`   Files: ${Array.from(existingFiles).join(', ')}`);
  }
  
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles,
    gitPort: state.deps?.git,  // ✅ Pass gitPort for disk checks
  });
  
  // Collect LLM output
  let thinking = '';
  let textResponse = '';
  let isDone = false;  // ✅ Track done event (don't propagate immediately)
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
      maxTokens: 16000,
      enableThinking: !isAfterToolCall,
    })) {
      await orchestrator.processEvent(event);
      
      if (event.type === 'thinking') {
        thinking += event.thinking || '';
      }
      
      if (event.type === 'text') {
        textResponse += event.text || '';
      }
      
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        
        if (toolCalls.length === 0) {
          await chatAPI.sendLLMEvent(event);
        }
        
        toolCalls.push({ id, name, args: input });
      }
      
      if (event.type === 'done') {
        isDone = true;
        
        // ✅ Extract token usage
        const { extractTokenUsageFromStreamEvent } = await import('../../../common/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
      }
    }
    
    // ✅ CRITICAL: Wait for all file operations to complete BEFORE finalizing
    // This ensures files are saved before task is marked as completed
    console.log(`\n💾 [CodeGen] Waiting for all file operations to complete...`);
    try {
      await orchestrator.waitForAllFileOperations();
      console.log(`✅ [CodeGen] All files saved successfully`);
    } catch (fileError) {
      // ❌ Do NOT throw! Let validation handle it
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      console.error(`⚠️ [CodeGen] File operation failed (will be caught by validation): ${errorMsg}`);
    }
    
    // ✅ NOW propagate done event (files are guaranteed to be saved OR errors recorded)
    if (isDone) {
      console.log(`✅ [CodeGen] Files saved, now propagating done event to UI`);
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
    console.log(`📝 [CodeGen] Extracted ${files.length} file(s) from streaming session`);
    
    // ✅ Finalize chat message if no tool calls (task/reasoning complete)
    if (toolCalls.length === 0) {
      const chatAPI = getChatAPIClient();
      await chatAPI.finalizeMessage();
    }
    
    console.log(`\n✅ [CodeGen] Reasoning complete`);
    console.log(`   Thinking: ${thinking.length} chars`);
    console.log(`   Text: ${textResponse.length} chars`);
    console.log(`   Tool calls: ${toolCalls.length}`);
    console.log(`   Files: ${files.length}`);
    if (capturedUsage) {
      console.log(`   Tokens: ${capturedUsage.totalTokens} total (${capturedUsage.inputTokens} in, ${capturedUsage.outputTokens} out)`);
      if (capturedUsage.cacheReadTokens) {
        console.log(`   Cache read: ${capturedUsage.cacheReadTokens} tokens`);
      }
      if (capturedUsage.cacheCreationTokens) {
        console.log(`   Cache creation: ${capturedUsage.cacheCreationTokens} tokens`);
      }
    }
    
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
    
    // ✅ projectCodeContext is plan-only data (immutable after plan node)
    // Plan node always regenerates it via RAG on retry - no need to update here
    
    return {
      llmResponse: {
        thinking,
        textResponse,
        toolCalls,
        done: toolCalls.length === 0,
        tokenUsage: capturedUsage,
      },
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
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

