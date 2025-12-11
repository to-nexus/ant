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
  
  // Add files from projectCodeContext
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
      
      // Done (just mark it, don't propagate yet - files might still be saving!)
      if (event.type === 'done') {
        isDone = true;
        // ❌ DO NOT propagate yet! Wait for files to be saved first
      }
    }
    
    // ✅ CRITICAL: Wait for all file operations to complete BEFORE finalizing
    // This ensures files are saved before task is marked as completed
    console.log(`\n💾 [CodeGen] Waiting for all file operations to complete...`);
    const fileErrors: string[] = [];
    try {
      await orchestrator.waitForAllFileOperations();
      console.log(`✅ [CodeGen] All files saved successfully`);
    } catch (fileError) {
      // ❌ Do NOT throw! Let validation handle it
      const errorMsg = fileError instanceof Error ? fileError.message : String(fileError);
      fileErrors.push(errorMsg);
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
    
    // ✅ CRITICAL: Update projectCodeContext.files (single source of truth)
    // Files are already written to disk, now update in-memory context
    let updatedProjectCodeContext = state.projectCodeContext;
    
    if (files.length > 0 && state.projectCodeContext) {
      const contextFiles = state.projectCodeContext.files || [];
      const fileMap = new Map<string, { path: string; content: string }>();
      
      // Add existing context files first
      for (const file of contextFiles) {
        if (file.path) {
          fileMap.set(file.path, file);
        }
      }
      
      // Overwrite with newly written files (latest version wins)
      for (const file of files) {
        if (file.path) {
          fileMap.set(file.path, {
            path: file.path,
            content: file.content
          });
        }
      }
      
      updatedProjectCodeContext = {
        ...state.projectCodeContext,
        files: Array.from(fileMap.values())
      };
      
      console.log(`📝 [CodeGen] Updated projectCodeContext.files: ${contextFiles.length} existing + ${files.length} new = ${updatedProjectCodeContext.files.length} total`);
    }
    
    return {
      llmResponse: {
        thinking,         // ✅ For UI display only (not in conversation history)
        textResponse,     // ✅ For conversation history (if no tool calls)
        toolCalls,        // ✅ For tool execution
        done: toolCalls.length === 0,  // ✅ Tool calls 없을 때만 done = true
      },
      projectCodeContext: updatedProjectCodeContext,  // ✅ Single source of truth
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,  // ✅ 파일 작업 실패를 validation으로 전달
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

