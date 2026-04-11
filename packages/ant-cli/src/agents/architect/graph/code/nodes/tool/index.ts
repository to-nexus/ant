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
import { TOOL_DISPLAY_NAMES, UI_CARD_ANIMATION_DELAY, isBuildCommand, isTestCommand, isTypecheckCommand } from './constants';
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
import { executeSearchWeb } from '../../../../tools/searchWeb';

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
        if (state._verificationTracker) {
          state._verificationTracker.typecheckPassed = false;
          state._verificationTracker.buildPassed = false;
          state._verificationTracker.testPassed = false;
        }
        if (state._activePhase !== 'plan') state._executeModifiedFiles = true;
        break;
      case 'edit_file':
        result = await handleEditFile(state, args as any);
        if (state._verificationTracker) {
          state._verificationTracker.typecheckPassed = false;
          state._verificationTracker.buildPassed = false;
          state._verificationTracker.testPassed = false;
        }
        if (state._activePhase !== 'plan') state._executeModifiedFiles = true;
        break;
      case 'mkdir':
        result = await handleMkdir(state, args as any);
        break;
      case 'run_command': {
        const output = await handleRunCommand(state, args as any);
        result = output.displayText;
        const { commandResult } = output;
        commandExecuted = {
          command: commandResult.command,
          success: commandResult.success,
          exitCode: commandResult.exitCode,
        };

        // Only update tracker for actually-executed commands.
        // Rejected commands (exitCode -1) must not overwrite previous success state.
        const tracker = state._verificationTracker;
        if (tracker && commandResult.exitCode !== -1) {
          if (isTypecheckCommand(commandResult.command)) {
            tracker.typecheckPassed = commandResult.success;
          }
          if (isBuildCommand(commandResult.command)) {
            tracker.buildPassed = commandResult.success;
          }
          if (isTestCommand(commandResult.command)) {
            tracker.testPassed = commandResult.success;
          }
        }
        break;
      }
      case 'search_reference_code':
        result = await handleSearchReferenceCode(state, args as any);
        break;
      case 'search_web':
        result = await executeSearchWeb(args as { query: string });
        break;
      case 'file':
      case 'write_file':
      case 'create_file':
        result = await handleCreateFile(state, args as any);
        if (state._verificationTracker) {
          state._verificationTracker.typecheckPassed = false;
          state._verificationTracker.buildPassed = false;
          state._verificationTracker.testPassed = false;
        }
        if (state._activePhase !== 'plan') state._executeModifiedFiles = true;
        break;
      case 'figma_get_design_context':
      case 'figma_get_screenshot':
      case 'figma_get_variable_defs':
      case 'figma_get_metadata': {
        const { callFigmaMCPTool, isFigmaImageResult, isFigmaCompositeResult, saveFigmaScreenshot } = await import('../../../../tools/figmaMCPHandler');
        const figmaChatAPI = getChatAPIClient();
        if (!state.figmaFileKey) throw new Error('Figma fileKey not configured');
        const figmaNodeId = args.nodeId as string | undefined;
        const figmaStatusMeta = { toolName: name, nodeId: figmaNodeId };
        const figmaMergeIdx = await figmaChatAPI.showChatStatus('figma_calling', figmaStatusMeta);
        try {
          const mcpResult = await callFigmaMCPTool(
            { userId: state.context?.userId, redis: state.deps?.redis, taskId: (state.currentTask as any)?.id },
            name, state.figmaFileKey, args.nodeId,
          );
          let imagePath: string | undefined;
          const imageData = isFigmaImageResult(mcpResult)
            ? mcpResult
            : isFigmaCompositeResult(mcpResult) ? mcpResult.image : null;
          if (imageData && state.context?.featurePath && args.nodeId) {
            try {
              imagePath = await saveFigmaScreenshot(state.context.featurePath, args.nodeId, imageData.base64, imageData.mimeType);
            } catch { /* non-critical */ }
          }
          await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, imagePath, _mergeIndex: figmaMergeIdx });

          if (isFigmaImageResult(mcpResult)) {
            result = { __figmaImage: true, base64: mcpResult.base64, mimeType: mcpResult.mimeType };
          } else if (isFigmaCompositeResult(mcpResult)) {
            result = {
              __figmaComposite: true,
              text: mcpResult.text,
              base64: mcpResult.image.base64,
              mimeType: mcpResult.image.mimeType,
            };
          } else {
            result = mcpResult;
          }
        } catch (err: any) {
          const { isFigmaRateLimitError } = await import('../../../../../../periphery/adapters/figma/errors');
          if (isFigmaRateLimitError(err)) throw err;
          await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, error: true, _mergeIndex: figmaMergeIdx });
          result = JSON.stringify({ error: err.message });
        }
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    console.log(`✅ [Tool] ${name} executed successfully`);
    const isImg = result && typeof result === 'object' && (result.__figmaImage || result.__figmaComposite);
    const resultPreview = isImg
      ? (result.__figmaComposite
        ? `[composite: text ${(result as any).text?.length ?? 0} chars + image ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`
        : `[image: ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`)
      : (typeof result === 'string'
        ? result.substring(0, 200)
        : JSON.stringify(result, null, 2).substring(0, 200));
    console.log(`   Result: ${resultPreview}...`);
  } catch (e) {
    const { isFigmaRateLimitError } = await import('../../../../../../periphery/adapters/figma/errors');
    if (isFigmaRateLimitError(e as Error)) throw e;

    error = (e as Error).message;
    console.error(`❌ [Tool] ${name} execution failed:`, error);

    if (name === 'run_command') {
      const cmdArgs = args as { command: string; working_directory?: string };
      commandExecuted = {
        command: cmdArgs.command,
        success: false,
        exitCode: -1
      };
      if (state._verificationTracker) {
        if (isTypecheckCommand(cmdArgs.command)) state._verificationTracker.typecheckPassed = false;
        if (isBuildCommand(cmdArgs.command)) state._verificationTracker.buildPassed = false;
        if (isTestCommand(cmdArgs.command)) state._verificationTracker.testPassed = false;
      }
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

    if (!commandExecuted.success) {
      try {
        const { diagnoseError } = await import('../diagnostics');
        const { errorStatsCollector } = await import('../diagnostics/errorStats');
        const errorOutput = error || (typeof result === 'string' ? result : '') || '';
        const diagnosis = diagnoseError(errorOutput, {
          command: commandExecuted.command,
          workDir: state.context?.featurePath,
        });
        if (diagnosis) {
          errorStatsCollector.recordError(diagnosis, {
            command: commandExecuted.command,
            workDir: state.context?.featurePath,
          });
        }
      } catch (diagErr) {
        console.warn(`⚠️  [Tool] Error diagnostics failed:`, (diagErr as Error).message);
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
      state.workerId ?? 0,
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }

  const chatAPI = getChatAPIClient();

  // Execute ALL tool calls sequentially, accumulate results
  const toolUseBlocks: import('../../../../../../core/ports/llm').ToolUseContentBlock[] = [];
  const toolResultBlocks: import('../../../../../../core/ports/llm').ToolResultContentBlock[] = [];
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

    // Build tool result content: multimodal image or truncated text
    let toolResultContent: any;
    const isImageResult = result && typeof result === 'object' && result.__figmaImage;
    const isCompositeResult = result && typeof result === 'object' && result.__figmaComposite;

    if (isImageResult) {
      const imgData = result as { __figmaImage: true; base64: string; mimeType: string };
      toolResultContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imgData.mimeType,
            data: imgData.base64,
          },
        },
        {
          type: 'text',
          text: `✅ Figma screenshot captured.\n\nAnalyze the visual layout, spacing, colors, typography, and component structure visible above.`,
        },
      ];
      console.log(`   🖼️  Multimodal: Figma screenshot added (${Math.round(imgData.base64.length / 1024)}KB ${imgData.mimeType})`);
    } else if (isCompositeResult) {
      const comp = result as { __figmaComposite: true; text: string; base64: string; mimeType: string };
      const truncation = toolResultManager.truncateResult(name, comp.text, error);
      toolResultContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: comp.mimeType,
            data: comp.base64,
          },
        },
        {
          type: 'text',
          text: typeof truncation.content === 'string' ? truncation.content : JSON.stringify(truncation.content),
        },
      ];
      if (truncation.wasTruncated) {
        console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
      }
      console.log(`   🖼️  Multimodal: Figma design context + screenshot (${Math.round(comp.base64.length / 1024)}KB ${comp.mimeType})`);
    } else {
      const toolFilePath = name === 'read_file' ? args.path : undefined;
      const truncation = toolResultManager.truncateResult(name, result, error, toolFilePath);
      toolResultContent = truncation.content;

      if (truncation.wasTruncated) {
        console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
      }
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
      tool_name: name,
      content: toolResultContent,
    });

    allToolResults.push({ toolCallId: id, result: (isImageResult || isCompositeResult) ? '[figma_image]' : result, error });
  }

  // Build batch conversation history (Anthropic multi-tool format)
  const taskReminder = state._activePhase === 'plan' ? undefined : buildTaskReminder(state);

  // Preserve file creation awareness: when LLM creates files AND uses tools in
  // the same response, the text portion (containing file tags) must be included
  // alongside tool_use blocks. Without this, the LLM loses memory of written
  // files and recreates them on the next execute call.
  const textResponse = state.llmResponse?.textResponse || '';
  const cleanedText = cleanFileContentFromResponse(textResponse);

  const assistantContent: import('../../../../../../core/ports/llm').MessageContentBlock[] = [];

  // Preserve thinking blocks for Anthropic API compatibility in multi-turn conversations.
  // When thinking is enabled, the assistant message must start with a thinking block.
  // The signature field is required by the Anthropic API to validate unmodified thinking blocks.
  if (state._activePhase === 'plan' && state.llmResponse?.thinking) {
    const resp = state.llmResponse as { thinking?: string; thinkingSignature?: string };
    assistantContent.push({
      type: 'thinking' as const,
      thinking: resp.thinking!,
      signature: resp.thinkingSignature || '',
    });
  }

  if (cleanedText) {
    assistantContent.push({ type: 'text' as const, text: cleanedText });
  }
  assistantContent.push(...toolUseBlocks);

  const baseHistory = state._activePhase === 'plan'
    ? (state.planConversationHistory || [])
    : (state.conversationHistory || []);

  const newHistory = [
    ...baseHistory,
    {
      role: 'assistant' as const,
      content: assistantContent,
    },
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
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', state.workerId ?? 0);
  }

  // Flush chat once per batch
  try {
    await chatAPI.flushToChatFile();
  } catch {
    // Non-critical: don't fail tool execution if chat flush fails
  }

  const nextLlmResponse = {
    ...state.llmResponse!,
    toolCalls: [],
  };

  if (state._activePhase === 'plan') {
    return {
      planConversationHistory: newHistory,
      llmResponse: nextLlmResponse,
      toolResults: [...(state.toolResults || []), ...allToolResults],
      planText: state.planText,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  return {
    conversationHistory: newHistory,
    llmResponse: nextLlmResponse,
    toolResults: [
      ...(state.toolResults || []),
      ...allToolResults,
    ],
    planText: state.planText,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  };
}
