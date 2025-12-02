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
 */

import { ArchitectGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../core/utils/toolResultManager';

// ❌ REMOVED: createMinimalThinking()
// New approach: Disable Extended Thinking after first tool call
// No need for thinking placeholder in conversation history

// ✅ Initialize tool result manager (singleton for consistency)
const tokenManager = new TokenBudgetManager();
const toolResultManager = new ToolResultManager(tokenManager);

export async function tool(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n🔧 [Tool] Executing tool...\n');
  
  // ✅ Get first tool call from llmResponse
  const toolCalls = state.llmResponse?.toolCalls || [];
  
  if (toolCalls.length === 0) {
    console.log('⚠️  [Tool] No tool call found, skipping');
    return {};
  }
  
  // 🎯 CRITICAL: Only process FIRST tool call (Standard Tool Calling pattern)
  const toolCall = toolCalls[0];
  const { id, name, args } = toolCall;
  
  // ✅ Log if multiple tool calls were dropped
  if (toolCalls.length > 1) {
    console.log(`   ⚠️  Multiple tool calls detected (${toolCalls.length}), processing FIRST only:`);
    console.log(`   ✅ Processing: ${name}`);
    console.log(`   ❌ Dropping: ${toolCalls.slice(1).map(tc => tc.name).join(', ')}`);
    console.log(`   💡 LLM will re-decide remaining actions in next turn\n`);
  }
  
  console.log(`   Tool: ${name}`);
  console.log(`   Args:`, JSON.stringify(args, null, 2));
  
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
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ✅ CRITICAL: Give UI time to render file card from tool_use event
  // This ensures smooth loading → complete animation for ALL files, not just the first one
  // Why needed:
  // - First file: LLM thinking provides natural delay → UI has time → animation works ✅
  // - Subsequent files: No thinking (disabled) → tool executes immediately → card rendered as completed ❌
  // - Solution: Intentional 150ms delay for UI card creation (NOT a hack, it's for UX consistency)
  if (name === 'write_file' || name === 'delete_file' || name === 'apply_patch') {
    await new Promise(resolve => setTimeout(resolve, 150));
    console.log('   ⏱️  UI preparation time provided (150ms) for smooth card animation');
  }
  
  let result: any;
  let error: string | undefined;
  
  try {
    // ✅ Execute tool
    switch (name) {
      case 'write_file':
        result = await handleWriteFile(state, args as { path: string; content: string });
        break;
      case 'read_file':
        result = await handleReadFile(state, args as { path: string });
        break;
      case 'list_files':
        result = await handleListFiles(state, args as { directory?: string; pattern?: string });
        break;
      case 'search_code':
        result = await handleSearchCode(state, args as { pattern: string; file_pattern?: string });
        break;
      case 'delete_file':
        result = await handleDeleteFile(state, args as { path: string });
        break;
      case 'mkdir':
        result = await handleMkdir(state, args as { path: string });
        break;
      case 'apply_patch':
        result = await handleApplyPatch(state, args as { path: string; patch: string });
        break;
      case 'run_command':
        result = await handleRunCommand(state, args as { command: string; working_directory?: string });
        break;
      case 'search_reference_code':
        result = await handleSearchReferenceCode(state, args as { project: string; query: string; maxFiles?: number });
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
  
  // ✅ Update conversation history
  // 🔴 NEW APPROACH: Don't include thinking in conversation history
  // Extended Thinking will be DISABLED for subsequent calls after tool use
  
  // ✅ Build reminder text with task description (for tool call loops)
  let taskReminder = '';
  if (state.currentTask) {
    taskReminder = `\n\n# Current Task Reminder\n` +
      `**${state.currentTask.name}** (${state.currentTask.type})\n\n` +
      `${state.currentTask.description}`;
    
    // ✅ CRITICAL: Setup task MUST install dependencies after config files
    if (state.currentTask.type === 'setup') {
      taskReminder += `\n\n⚠️  **SETUP TASK - MANDATORY STEPS:**\n` +
        `1. ✅ Generate ALL config files (package.json, tsconfig.json, etc.)\n` +
        `2. ⚠️  **RUN: npm install** (or pnpm/yarn install)\n` +
        `3. ✅ Output: <done>true</done>\n\n` +
        `🚫 DO NOT create directories (mkdir) - folders are created automatically when files are added!\n` +
        `🚫 If you skip "npm install", setup FAILS!\n` +
        `✅ After "npm install" completes, output <done>true</done>`;
    }
  }
  
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
  
  // ✅ Convert fileBuffers to state.files for validation
  const files: Array<{ path: string; content: string; actionType: 'create' | 'edit' | 'append' | 'delete' }> = [];
  if (state.fileBuffers) {
    for (const [path, buffer] of state.fileBuffers.entries()) {
      files.push({
        path: buffer.path,
        content: buffer.content,
        actionType: buffer.actionType as 'create' | 'edit' | 'append' | 'delete',
      });
    }
  }
  
  // ❌ REMOVED: Don't finalize message here! 
  // Message finalize should only happen when the entire job completes (learn node, etc.)
  // Tool node continues the loop back to codeGen, so message must stay open
  
  // ✅ Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool');
  }
  
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
    files,  // ✅ Pass files for validation
  };
}

/**
 * ✅ Handle write_file tool
 * 💡 TRUE INCREMENTAL SAVING: Writes directly to project disk (Cursor style)
 */
async function handleWriteFile(
  state: ArchitectGraphState,
  args: { path: string; content: string }
): Promise<string> {
  const { path: filePath, content } = args;
  
  if (!filePath || content === undefined) {
    throw new Error('write_file requires path and content');
  }
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // Determine action type
  const exists = await gitPort.fileExists(filePath);
  const actionType = exists ? 'edit' : 'create';
  
  // ✅ 0. UI notification - START (show writing state for better UX)
  const chatAPI = getChatAPIClient();
  if (actionType === 'create') {
    // Update to 'writing' state (shows progress)
    await chatAPI.updateFileProgress(filePath, 'writing');
  } else {
    // For edit, show editing state
    await chatAPI.startFileEdit(filePath);
  }
  
  // ✅ 1. Read existing content BEFORE writing (for diff) - with error handling
  let existingContent = '';
  if (exists) {
    try {
      existingContent = await gitPort.readFile(filePath) || '';
    } catch (readError) {
      // If read fails, continue with empty diff (file write is more important!)
      console.warn(`⚠️  Failed to read existing content for diff: ${(readError as Error).message}`);
      existingContent = '';
    }
  }
  
  // ✅ 2. IMMEDIATELY write to project disk (점진적 저장!)
  await gitPort.writeFile(filePath, content);
  console.log(`   💾 ${actionType === 'create' ? 'Created' : 'Modified'}: ${filePath} (${content.length} bytes)`);
  console.log(`   ✅ Saved to disk IMMEDIATELY (true incremental saving)`);
  
  // ✅ 3. Update buffer in state (for tracking & potential rollback)
  const fileBuffers = state.fileBuffers || new Map();
  fileBuffers.set(filePath, {
    path: filePath,
    content,
    actionType,
    committed: true,  // Already committed to disk!
  });
  
  // ✅ 4. UI notification - COMPLETE
  if (actionType === 'create') {
    await chatAPI.completeFileCreation(filePath, content);
  } else {
    await chatAPI.completeFileEdit(filePath, existingContent, content);
  }
  
  // ✅ 4. Broadcast file tree update (for "n Files Edited" counter)
  if (state.deps?.fileTreeUpdate) {
    const featureName = state.context.featureFolder || 'default';
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
      state.context.project,
      featureName
    );
  }
  
  return `File ${filePath} ${actionType === 'create' ? 'created' : 'updated'} (${content.length} bytes, saved to disk)`;
}

/**
 * ✅ Handle read_file tool
 */
async function handleReadFile(
  state: ArchitectGraphState,
  args: { path: string }
): Promise<string> {
  const { path: filePath } = args;
  
  if (!filePath) {
    throw new Error('read_file requires path');
  }
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  try {
    // ✅ Check buffer first (uncommitted changes)
    const fileBuffers = state.fileBuffers || new Map();
    const buffered = fileBuffers.get(filePath);
    
    if (buffered && !buffered.committed) {
      console.log(`   📦 Reading from buffer: ${filePath}`);
      await chatAPI.addReadComplete(filePath);
      return buffered.content;
    }
    
    // ✅ Read from disk
    const content = await gitPort.readFile(filePath);
    
    if (!content) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    console.log(`   💾 Read from disk: ${filePath} (${content.length} bytes)`);
    
    // ✅ UI notification: read complete (success)
    await chatAPI.addReadComplete(filePath);
    
    return content;
  } catch (error) {
    // ✅ Update reading status with error message
    await chatAPI.addReadComplete(filePath, (error as Error).message);
    throw error;
  }
}

/**
 * ✅ Handle list_files tool
 */
async function handleListFiles(
  state: ArchitectGraphState,
  args: { directory?: string; pattern?: string }
): Promise<string[]> {
  const { directory = '.', pattern } = args;
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Use GitPort instead of direct fs access (Hexagonal Architecture)
  const items = await gitPort.readDirectory(directory);
  
  // ✅ Add type suffix for directories so UI can distinguish them
  const itemsWithType = items.map(item => 
    item.isDirectory ? `${item.name}/` : item.name
  );
  
  // Filter by pattern if provided
  const filtered = pattern 
    ? itemsWithType.filter(f => f.includes(pattern))
    : itemsWithType;
  
  console.log(`   📁 Listed ${filtered.length} items in ${directory}`);
  
  // ✅ UI notification: exploration complete
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('explored', { 
    filesCount: filtered.length,
    filesList: filtered 
  });
  
  return filtered;
}

/**
 * ✅ Handle search_code tool
 */
async function handleSearchCode(
  state: ArchitectGraphState,
  args: { pattern: string; file_pattern?: string }
): Promise<string> {
  const { pattern, file_pattern } = args;
  
  if (!pattern) {
    throw new Error('search_code requires pattern');
  }
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Use GitPort to list files (Hexagonal Architecture)
  const files = await gitPort.listFiles('.', ['node_modules', '.git', 'dist', 'build']);
  
  // Filter by file pattern if provided
  const filteredFiles = file_pattern
    ? files.filter(f => f.includes(file_pattern))
    : files;
  
  // Search through files
  const results: string[] = [];
  for (const file of filteredFiles.slice(0, 50)) {  // Limit to 50 files
    const content = await gitPort.readFile(file);
    if (!content) continue;
    
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.includes(pattern)) {
        results.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  
  console.log(`   🔍 Found ${results.length} matches for "${pattern}"`);
  
  // ✅ UI notification: search complete
  const chatAPI = getChatAPIClient();
  const matchedFiles = [...new Set(results.map(r => r.split(':')[0]))];
  await chatAPI.showChatStatus('explored', { 
    filesCount: matchedFiles.length,
    filesList: matchedFiles 
  });
  
  return results.join('\n');
}

/**
 * Get temp file path for buffering
 * Note: This is a pure string manipulation, no fs access
 */
function getTempFilePath(state: ArchitectGraphState, filePath: string): string {
  const jobId = state._httpJobId || 'unknown';
  const safeFilePath = filePath.replace(/\//g, '_');
  return `/tmp/ant-buffer-${jobId}-${safeFilePath}`;
}

/**
 * Handle delete_file tool
 */
async function handleDeleteFile(
  state: ArchitectGraphState,
  args: { path: string }
): Promise<string> {
  const { path: filePath } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // Check if file exists
  const exists = await gitPort.fileExists(filePath);
  if (!exists) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  
  // Delete file
  await gitPort.deleteFile(filePath);
  console.log(`   🗑️  Deleted: ${filePath}`);
  
  // UI notification
  await chatAPI.completeFileDeletion(filePath);
  
  // ✅ Broadcast file tree update (for "n Files Edited" counter)
  if (state.deps?.fileTreeUpdate) {
    const featureName = state.context.featureFolder || 'default';
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
      state.context.project,
      featureName
    );
  }
  
  return `File deleted successfully: ${filePath}`;
}

/**
 * Handle mkdir tool
 */
async function handleMkdir(
  state: ArchitectGraphState,
  args: { path: string }
): Promise<string> {
  const { path: dirPath } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // Create directory
  await gitPort.createDirectory(dirPath);
  console.log(`   📁 Created directory: ${dirPath}`);
  
  return `Directory created: ${dirPath}`;
}

/**
 * Handle apply_patch tool
 */
async function handleApplyPatch(
  state: ArchitectGraphState,
  args: { path: string; patch: string }
): Promise<string> {
  const { path: filePath, patch } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // Check if file exists
  const exists = await gitPort.fileExists(filePath);
  if (!exists) {
    throw new Error(`File does not exist: ${filePath}. Use write_file to create new files.`);
  }
  
  // Read original content
  const originalContent = await gitPort.readFile(filePath);
  if (!originalContent) {
    throw new Error(`Failed to read file: ${filePath}`);
  }
  
  // Apply patch (using the applyUnifiedDiff function from file-tools)
  const patchedContent = applyUnifiedDiff(originalContent, patch);
  
  if (!patchedContent) {
    throw new Error(`Failed to apply patch: Invalid diff format or patch doesn't match file content`);
  }
  
  // Write patched content
  await gitPort.writeFile(filePath, patchedContent);
  
  const originalLines = originalContent.split('\n').length;
  const patchedLines = patchedContent.split('\n').length;
  const delta = patchedLines - originalLines;
  
  console.log(`   ✏️  Patched: ${filePath} (${delta > 0 ? '+' : ''}${delta} lines)`);
  
  // UI notification
  await chatAPI.startFileEdit(filePath);
  await chatAPI.completeFileEdit(filePath, originalContent, patchedContent);
  
  // ✅ Broadcast file tree update (for "n Files Edited" counter)
  if (state.deps?.fileTreeUpdate) {
    const featureName = state.context.featureFolder || 'default';
    await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
      state.context.project,
      featureName
    );
  }
  
  return `Patch applied successfully to ${filePath} (${delta > 0 ? '+' : ''}${delta} lines)`;
}

/**
 * Apply unified diff to content
 * (Copied from file-tools.ts for now - TODO: extract to shared utility)
 */
function applyUnifiedDiff(originalContent: string, patch: string): string | null {
  try {
    const lines = originalContent.split('\n');
    const patchLines = patch.split('\n');

    // Parse hunks from patch
    const hunks: Array<{
      originalStart: number;
      originalCount: number;
      newStart: number;
      newCount: number;
      lines: string[];
    }> = [];

    let currentHunk: typeof hunks[0] | null = null;

    for (const line of patchLines) {
      // Parse hunk header: @@ -10,5 +10,6 @@
      const hunkMatch = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          originalStart: parseInt(hunkMatch[1]),
          originalCount: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newCount: parseInt(hunkMatch[4] || '1'),
          lines: [],
        };
        continue;
      }

      // Add lines to current hunk
      if (currentHunk) {
        currentHunk.lines.push(line);
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    if (hunks.length === 0) {
      return null;  // No valid hunks found
    }

    // Apply hunks in reverse order to maintain line numbers
    let result = [...lines];

    for (let i = hunks.length - 1; i >= 0; i--) {
      const hunk = hunks[i];
      const startLine = hunk.originalStart - 1;  // 0-indexed

      // Extract changes from hunk
      const removals: number[] = [];
      const additions: string[] = [];
      let lineOffset = 0;

      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          removals.push(lineOffset);
          lineOffset++;
        } else if (line.startsWith('+')) {
          additions.push(line.substring(1));
        } else if (line.startsWith(' ')) {
          lineOffset++;
        }
      }

      // Apply removals (in reverse to maintain indices)
      for (let j = removals.length - 1; j >= 0; j--) {
        const removeIndex = startLine + removals[j];
        result.splice(removeIndex, 1);
      }

      // Apply additions
      if (additions.length > 0) {
        result.splice(startLine + removals[0] || startLine, 0, ...additions);
      }
    }

    return result.join('\n');
  } catch (error) {
    console.error(`❌ Failed to apply patch:`, error);
    return null;
  }
}

/**
 * Handle run_command tool
 * CRITICAL: Allows LLM to install dependencies, run builds, tests, etc.
 * 
 * ❌ BLOCKS: Dev servers (npm run dev, start, serve) - they never exit
 * ✅ ALLOWS: Build, test, lint commands - they exit immediately
 */
async function handleRunCommand(
  state: ArchitectGraphState,
  args: { command: string; working_directory?: string }
): Promise<string> {
  const { command, working_directory } = args;
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  
  if (!commandPort) {
    throw new Error('CommandPort not available');
  }
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // ✅ CRITICAL: Block long-running dev server commands
  const longRunningPatterns = [
    /npm\s+run\s+dev\b/,
    /npm\s+run\s+serve\b/,
    /npm\s+start\b/,
    /yarn\s+dev\b/,
    /yarn\s+serve\b/,
    /yarn\s+start\b/,
    /pnpm\s+dev\b/,
    /pnpm\s+serve\b/,
    /pnpm\s+start\b/,
    /node\s+.*server\.js/,
    /nodemon\b/,
    /npx\s+vite\b/,
    /npx\s+next\s+dev\b/,
    /npx\s+react-scripts\s+start\b/
  ];
  
  for (const pattern of longRunningPatterns) {
    if (pattern.test(command)) {
      const errorMsg = `❌ COMMAND BLOCKED: ${command}

This is a long-running dev server command that never exits.
It would hang for 10 minutes until timeout.

❌ NEVER use these commands:
- npm run dev
- npm run serve  
- npm start
- node server.js
- nodemon

✅ ONLY use these commands for verification:
- npm run build (compiles and exits)
- npm run type-check (validates and exits)
- npm run lint (checks and exits)
- npm test (tests and exits)
- npx tsc --noEmit (type checks and exits)

Use build/test commands instead of dev servers.`;

      console.error(`\n   ❌ ${errorMsg}\n`);
      await chatAPI.commandComplete(command, false, -1, errorMsg);
      
      return errorMsg;
    }
  }
  
  // Get project path
  const projectPath = await gitPort.getRepoRoot();
  const workingDir = working_directory 
    ? `${projectPath}/${working_directory}`
    : projectPath;
  
  console.log(`\n   🔧 Running command: ${command}`);
  console.log(`   📁 Working directory: ${workingDir}\n`);
  
  let streamedStdout = '';
  let streamedStderr = '';
  
  try {
    // ✅ Execute command with timeout (10 minutes for installs/builds)
    const result = await commandPort.execute(command, {
      cwd: workingDir,
      timeout: 10 * 60 * 1000, // 10 minutes
      onStdout: (chunk: string) => {
        streamedStdout += chunk;
        console.log(chunk);
      },
      onStderr: (chunk: string) => {
        streamedStderr += chunk;
        console.error(chunk);
      },
      onExit: (code: number) => {
        console.log(`   Exit code: ${code}`);
      },
    });
    
    // ✅ Use result from execute (more reliable than callbacks)
    const { stdout, stderr, exitCode, success } = result;
    const output = stdout + stderr;
    
    if (success) {
      console.log(`\n   ✅ Command succeeded (exit code: ${exitCode})\n`);
    } else {
      console.error(`\n   ❌ Command failed (exit code: ${exitCode})\n`);
    }
    
    // ✅ UI notification: command complete
    await chatAPI.commandComplete(command, success, exitCode, output);
    
    // ✅ Format result - emphasize errors for LLM attention
    if (!success) {
      // ❌ BUILD FAILED - Return error-first format
      return `❌ COMMAND FAILED: ${command}
Exit Code: ${exitCode}

📋 ERROR OUTPUT:
${output}

⚠️  You MUST read the error above and fix the specific issue mentioned.
DO NOT guess - the error tells you exactly what's wrong.`;
    }
    
    // ✅ SUCCESS - Return with output (may contain useful warnings/info)
    const hasOutput = output.trim().length > 0;
    
    if (hasOutput) {
      return `✅ COMMAND SUCCEEDED: ${command}
Exit Code: 0

Output:
${output}`;
    } else {
      return `✅ COMMAND SUCCEEDED: ${command}
Exit Code: 0
(No output)`;
    }
  } catch (error) {
    // ✅ Handle timeout or execution errors
    const errorMessage = (error as Error).message;
    console.error(`\n   ❌ Command execution error: ${errorMessage}\n`);
    
    // ✅ UI notification: command failed
    await chatAPI.commandComplete(command, false, -1, errorMessage);
    
    // ✅ Timeout/execution error - Return error-first format
    return `❌ COMMAND EXECUTION ERROR: ${command}
Error: ${errorMessage}

Captured output:
${streamedStdout}
${streamedStderr}

⚠️  The command timed out or failed to execute. Check the error above.`;
  }
}

/**
 * Handle read_reference_file tool
 * Read a file from a reference project (e.g., backend when working on frontend)
 */
/**
 * Handle search_reference_code tool
 * Search reference project using vector DB semantic search
 */
async function handleSearchReferenceCode(
  state: ArchitectGraphState,
  args: { project: string; query: string; maxFiles?: number }
): Promise<string> {
  const { project, query, maxFiles = 5 } = args;
  
  console.log(`   🔍 Searching reference project: ${project}`);
  console.log(`   Query: "${query}"`);
  
  const chatAPI = getChatAPIClient();
  
  try {
    // 1. Check if this reference project was registered
    const refRequest = state.referenceRequests?.find(r => r.project === project);
    if (!refRequest) {
      return `❌ ERROR: Reference project "${project}" was not registered.

Available reference projects: ${state.referenceRequests?.map(r => r.project).join(', ') || 'none'}

Please mention the reference project in your directive to register it.`;
    }
    
    // 2. Check dependencies
    if (!state.deps?.retriever || !state.deps?.vectorDB || !state.deps?.git || !state.deps?.workspaceResolver) {
      throw new Error('Required dependencies not available (retriever, vectorDB, git, workspaceResolver)');
    }
    
    // 3. UI: Show searching status
    await chatAPI.showChatStatus('searching_reference', {
      project: project,
      query: query
    });
    
    // 4. Resolve reference project path
    const userContext = {
      userId: state.context.userId || 'local',
      organizationId: state.context.organizationId || 'local',
      workspacePath: ''
    };
    
    const refProjectPath = state.deps.workspaceResolver.getProjectPath(userContext, project);
    const refCodebasePath = require('path').join(refProjectPath, 'codebase');
    
    // 5. Search vector DB using CodebaseRetriever
    const codeMode = state.codeMode === 'ambiguous' ? 'generate' : (state.codeMode || 'generate');
    const searchResult = await state.deps.retriever.retrieve(
      query,
      refCodebasePath,
      { git: state.deps.git, vectorDB: state.deps.vectorDB },
      {
        maxFiles: Math.min(maxFiles, 10),  // Cap at 10
        maxTokens: 15000,  // Reasonable limit
        mode: codeMode
      }
    );
    
    if (!searchResult.code || searchResult.code.trim().length === 0) {
      console.log(`   ⚠️  No relevant code found in ${project}\n`);
      
      // UI: Show search failed
      await chatAPI.showChatStatus('searched_reference', {
        project: project,
        filesCount: 0,
        error: 'No relevant code found'
      });
      
      return `⚠️  No relevant code found in reference project "${project}" for query: "${query}"

Try:
- Using different keywords
- Being more specific about what you need
- Searching for broader concepts (e.g., "API endpoints" instead of specific method names)`;
    }
    
    console.log(`   ✅ Found ${searchResult.stats.filesLoaded} relevant files (${searchResult.stats.estimatedTokens} tokens)\n`);
    
    // 5. Update UI: Show search complete + explored files
    const filesList = searchResult.files?.map((f: any) => `[${project}] ${f.path}`) || [];
    
    await chatAPI.showChatStatus('searched_reference', {
      project: project,
      filesCount: searchResult.stats.filesLoaded
    });
    
    if (filesList.length > 0) {
      await chatAPI.showChatStatus('explored', {
        filesCount: searchResult.stats.filesLoaded,
        filesList: filesList
      });
    }
    
    // 6. Format result
    return `✅ Found ${searchResult.stats.filesLoaded} relevant file(s) in "${project}":

${searchResult.code}

**Note:** This code is from the reference project "${project}". Use it to understand APIs, data structures, and implementation patterns. Do NOT modify these files.`;
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`   ❌ Failed to search reference project: ${errorMessage}\n`);
    
    return `❌ ERROR: Failed to search reference project "${project}"
Query: "${query}"
Error: ${errorMessage}`;
  }
}

