/**
 * Tool Node - 도구 실행 (배치 지원)
 * 
 * 책임:
 * - LLM이 요청한 도구들을 순차 실행
 * - 결과를 state에 저장
 * - 대화 히스토리 업데이트 (Anthropic batch format)
 * 
 * 하지 않는 것:
 * - LLM 호출
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
import { cleanFileContentFromResponse } from '../../utils/responseCleaners';
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

/**
 * Execute a single tool by name
 */
async function executeToolByName(
  name: string,
  state: ArchitectGraphState,
  args: Record<string, any>
): Promise<{ result: any; error?: string; commandExecuted?: CommandExecutionResult }> {
  let result: any;
  let error: string | undefined;
  let commandExecuted: CommandExecutionResult | undefined;

  try {
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
      case 'file':
      case 'write_file':
      case 'create_file':
        result = await handleCreateFile(state, args as any);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    console.log(`✅ [Tool] ${name} executed successfully`);
    const resultPreview = typeof result === 'string'
      ? result.substring(0, 200)
      : JSON.stringify(result, null, 2).substring(0, 200);
    console.log(`   Result: ${resultPreview}...`);
  } catch (e) {
    error = (e as Error).message;
    console.error(`❌ [Tool] ${name} execution failed:`, error);

    if (name === 'run_command') {
      const cmdArgs = args as { command: string; working_directory?: string };
      commandExecuted = {
        command: cmdArgs.command,
        success: false,
        exitCode: -1
      };
    }
  }

  // Update command history (if run_command was executed)
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

  return { result, error, commandExecuted };
}

export async function tool(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  const toolCalls = state.llmResponse?.toolCalls || [];

  if (toolCalls.length === 0) {
    return {
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // Workflow: enter once per batch
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
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }

  const chatAPI = getChatAPIClient();

  // Execute ALL tool calls sequentially, accumulate results
  const toolUseBlocks: any[] = [];
  const toolResultBlocks: any[] = [];
  const allToolResults: Array<{ toolCallId: string; result: any; error?: string }> = [];

  console.log(`🔧 [Tool] Executing ${toolCalls.length} tool call(s)`);

  for (const tc of toolCalls) {
    const { id, name, args } = tc;
    console.log(`🔧 [Tool] ${name}`);

    // UI status per tool
    const toolDisplayName = TOOL_DISPLAY_NAMES[name] || `🔧 ${name}`;
    await chatAPI.showChatStatus('placeholder', { content: toolDisplayName });

    // UI animation delay for delete_file
    if (name === 'delete_file') {
      await new Promise(resolve => setTimeout(resolve, UI_CARD_ANIMATION_DELAY));
    }

    // Execute
    const { result, error } = await executeToolByName(name, state, args);

    // Truncate result per tool
    const truncation = toolResultManager.truncateResult(name, result, error);

    if (truncation.wasTruncated) {
      console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    }

    // Accumulate Anthropic-format blocks
    toolUseBlocks.push({
      type: 'tool_use',
      id,
      name,
      input: args,
    });

    toolResultBlocks.push({
      type: 'tool_result',
      tool_use_id: id,
      content: truncation.content,
    });

    allToolResults.push({ toolCallId: id, result, error });
  }

  // Build batch conversation history (Anthropic multi-tool format)
  const taskReminder = buildTaskReminder(state);

  // Preserve file creation awareness: when LLM creates files AND uses tools in
  // the same response, the text portion (containing file tags) must be included
  // alongside tool_use blocks. Without this, the LLM loses memory of written
  // files and recreates them on the next codeGen call.
  const textResponse = state.llmResponse?.textResponse || '';
  const cleanedText = cleanFileContentFromResponse(textResponse);

  const assistantContent = cleanedText
    ? [{ type: 'text' as const, text: cleanedText }, ...toolUseBlocks]
    : toolUseBlocks;

  const newHistory = [
    ...(state.conversationHistory || []),
    {
      role: 'assistant' as const,
      content: assistantContent,
    },
    // Single user message with ALL tool_result blocks + task reminder
    {
      role: 'user' as const,
      content: [
        ...toolResultBlocks,
        ...(taskReminder ? [{
          type: 'text' as const,
          text: taskReminder,
        }] : []),
      ],
    },
  ];

  // Workflow: exit once per batch
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', (state as any).workerId ?? 0);
  }

  // Flush chat once per batch
  try {
    await chatAPI.flushToChatFile();
  } catch {
    // Non-critical: don't fail tool execution if chat flush fails
  }

  return {
    conversationHistory: newHistory,
    llmResponse: {
      ...state.llmResponse!,
      toolCalls: [],
    },
    toolResults: [
      ...(state.toolResults || []),
      ...allToolResults,
    ],
    planText: state.planText,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  };
}
