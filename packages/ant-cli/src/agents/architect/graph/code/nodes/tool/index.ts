/**
 * Tool Node - 단일 도구 실행
 * 
 * 책임:
 * - LLM이 요청한 도구 하나 실행
 * - 결과를 state에 저장
 * - 대화 히스토리 업데이트
 * 
 * 하지 않는 것:
 * - LLM 호출
 * - 여러 도구 동시 실행 (한 번에 하나씩)
 * - 루프
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * FILE ACCESS STRATEGY
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * | Tool                  | Source          | Description                    |
 * |-----------------------|-----------------|--------------------------------|
 * | read_file             | Local Disk      | Current project file (GitPort) |
 * | list_files            | Local Disk      | Directory listing              |
 * | search_code           | Local Disk      | Grep-style text search         |
 * | delete_file           | Local Disk      | Delete single file             |
 * | mkdir                 | Local Disk      | Create directory               |
 * | run_command           | Local Disk      | Shell command execution        |
 * | search_reference_code | Vector DB       | Semantic search in ref project |
 * 
 * FILE OPERATIONS:
 * - <file> XML tag: Create NEW file (streamed in real-time)
 * - <append> XML tag: Append to EXISTING file (streamed in real-time)
 * - edit_file tool: Modify EXISTING file (tool action)
 * 
 * WHY LOCAL DISK for current project:
 * - Ensures latest state (including uncommitted changes)
 * - Buffer system tracks in-memory edits
 * - No indexing delay
 * 
 * WHY VECTOR DB for reference projects:
 * - Semantic search across large codebases
 * - Pre-indexed for fast retrieval
 * - Read-only access (no modifications)
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { ArchitectGraphState } from '../../state';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { toolResultManager } from './utils/managers';
import { buildTaskReminder, updateCommandHistory } from './utils/helpers';
import { TOOL_DISPLAY_NAMES, UI_CARD_ANIMATION_DELAY } from './constants';
import { CommandExecutionResult } from './types';
import {
  handleReadFile,
  handleListFiles,
  handleSearchCode,
  handleDeleteFile,
  handleEditFile,
  handleMkdir,
  handleRunCommand,
  handleSearchReferenceCode,
  handleCreateFile
} from './handlers';

export async function tool(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  // Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // Get first tool call from llmResponse
  const toolCalls = state.llmResponse?.toolCalls || [];
  
  if (toolCalls.length === 0) {
    return {
      recursionCount: state.recursionCount,   // ✅ FIX: Propagate even on empty tool calls
      recursionLimit: state.recursionLimit,
    };
  }
  
  // Only process FIRST tool call (Standard Tool Calling pattern)
  const toolCall = toolCalls[0];
  const { id, name, args } = toolCall;
  
  console.log(`🔧 [Tool] ${name}`);
  
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
      'tool', 
      (state as any).workerId ?? 0,
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // 🚨 NEW: Notify chat UI about tool execution start
  const chatAPI = getChatAPIClient();
  const toolDisplayName = TOOL_DISPLAY_NAMES[name] || `🔧 ${name}`;
  
  // Use placeholder instead, which will auto-merge or disappear
  await chatAPI.showChatStatus('placeholder', {
    content: toolDisplayName
  });
  
  // ✅ CRITICAL: Give UI time to render file card from tool_use event
  // This ensures smooth loading → complete animation for ALL files, not just the first one
  // Why needed:
  // - First file: LLM thinking provides natural delay → UI has time → animation works ✅
  // - Subsequent files: No thinking (disabled) → tool executes immediately → card rendered as completed ❌
  // - Solution: Intentional 150ms delay for UI card creation (NOT a hack, it's for UX consistency)
  if (name === 'delete_file') {
    await new Promise(resolve => setTimeout(resolve, UI_CARD_ANIMATION_DELAY));
    console.log('   ⏱️  UI preparation time provided (150ms) for smooth card animation');
  }
  
  let result: any;
  let error: string | undefined;
  let commandExecuted: CommandExecutionResult | undefined;
  
  try {
    // ✅ Execute tool
    switch (name) {
      case 'read_file':
        result = await handleReadFile(state, args as any);
        break;
      case 'list_files':
        result = await handleListFiles(state, args as any);
        break;
      case 'search_code':
        result = await handleSearchCode(state, args as any);
        break;
      case 'delete_file':
        result = await handleDeleteFile(state, args as any);
        break;
      case 'edit_file':
        result = await handleEditFile(state, args as any);
        break;
      case 'mkdir':
        result = await handleMkdir(state, args as any);
        break;
      case 'run_command':
        result = await handleRunCommand(state, args as any);
        // ✅ Track command execution for loop detection
        const cmdArgs = args as { command: string; working_directory?: string };
        const isSuccess = typeof result === 'string' && result.includes('✅ COMMAND SUCCEEDED');
        const exitCodeMatch = result.match(/Exit Code: (\d+)/);
        commandExecuted = {
          command: cmdArgs.command,
          success: isSuccess,
          exitCode: exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined
        };
        break;
      case 'search_reference_code':
        result = await handleSearchReferenceCode(state, args as any);
        break;
      // Shadow tools: file creation (not exposed to LLM, but handled gracefully)
      case 'file':
      case 'write_file':
      case 'create_file':
        result = await handleCreateFile(state, args as any);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    console.log(`✅ [Tool] Tool executed successfully`);
    const resultPreview = typeof result === 'string' 
      ? result.substring(0, 200) 
      : JSON.stringify(result, null, 2).substring(0, 200);
    console.log(`   Result: ${resultPreview}...`);
  } catch (e) {
    error = (e as Error).message;
    console.error(`❌ [Tool] Tool execution failed:`, error);
    
    // ✅ Track failed command execution
    if (name === 'run_command') {
      const cmdArgs = args as { command: string; working_directory?: string };
      commandExecuted = {
        command: cmdArgs.command,
        success: false,
        exitCode: -1
      };
    }
  }
  
  // ✅ Update command history (if run_command was executed)
  if (commandExecuted) {
    const { shouldWarn, warningMessage } = updateCommandHistory(
      state,
      commandExecuted,
      error,
      result
    );
    
    if (shouldWarn && warningMessage) {
      if (typeof result === 'string') {
        result = result + warningMessage;
      } else if (error) {
        error = error + warningMessage;
      }
    }
  }
  
  // ✅ Truncate tool result to prevent token overflow
  const truncation = toolResultManager.truncateResult(name, result, error);
  
  // ✅ Build tool result content (Anthropic format)
  const toolResultContent = truncation.content;
  
  // ✅ Log if truncated
  if (truncation.wasTruncated) {
    console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    console.log(`   Reason: ${truncation.reason}`);
  }
  
  // ✅ Build reminder text with task description (for tool call loops)
  const taskReminder = buildTaskReminder(state);
  
  const newHistory = [
    ...(state.conversationHistory || []),
    // Assistant's response (only tool_use, no thinking)
    {
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_use',
          id,
          name,
          input: args,
        },
      ],
    },
    // User's tool result + task reminder
    {
      role: 'user' as const,
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: toolResultContent,
        },
        ...(taskReminder ? [{
          type: 'text' as const,
          text: taskReminder,
        }] : []),
      ],
    },
  ];
  
  // ✅ Drop ALL tool calls (standard pattern: LLM re-decides next action)
  // This ensures LLM has full context to decide what to do next
  const remainingToolCalls: any[] = [];
  
  // ✅ Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', (state as any).workerId ?? 0);
  }
  
  // ✅ CRITICAL: Preserve planText across tool calls
  // Without this, planText gets lost after first tool execution
  // causing "planText is missing" error in subsequent CodeGen calls
  return {
    conversationHistory: newHistory,
    llmResponse: {
      ...state.llmResponse!,
      toolCalls: remainingToolCalls,
    },
    toolResults: [
      ...(state.toolResults || []),
      {
        toolCallId: id,
        result,
        error,
      },
    ],
    planText: state.planText,  // ✅ FIX: Explicitly preserve planText
    recursionCount: state.recursionCount,   // ✅ FIX: Propagate to LangGraph channel (Partial return requires explicit inclusion)
    recursionLimit: state.recursionLimit,   // ✅ FIX: Propagate to LangGraph channel
  };
}

