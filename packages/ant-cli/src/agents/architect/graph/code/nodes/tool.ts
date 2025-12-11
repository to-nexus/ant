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
 * FILE OPERATIONS (XML Streaming - NOT tools):
 * - <file>: Create NEW file
 * - <edit>: Modify EXISTING file
 * - <append>: Append to EXISTING file
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
  
  // 🚨 NEW: Notify chat UI about tool execution start
  const chatAPI = getChatAPIClient();
  const toolDisplayName = {
    'read_file': '📖 Reading file',
    'list_files': '📂 Listing files',
    'search_code': '🔍 Searching code',
    'delete_file': '🗑️ Deleting file',
    'mkdir': '📁 Creating directory',
    'run_command': '⚙️ Running command',
    'search_reference_code': '🔎 Searching reference'
  }[name] || `🔧 ${name}`;
  
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
    await new Promise(resolve => setTimeout(resolve, 150));
    console.log('   ⏱️  UI preparation time provided (150ms) for smooth card animation');
  }
  
  let result: any;
  let error: string | undefined;
  
  try {
    // ✅ Execute tool
    switch (name) {
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
  
  // ✅ Convert fileBuffers to files list for projectCodeContext update
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
  
  // ✅ CRITICAL: Update projectCodeContext.files (single source of truth)
  // Tool node CAN create files (e.g., delete_file operations)
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
    
    // Overwrite with new files (latest version wins)
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
    
    console.log(`📝 [Tool] Updated projectCodeContext.files: ${contextFiles.length} existing + ${files.length} new = ${updatedProjectCodeContext.files.length} total`);
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
    projectCodeContext: updatedProjectCodeContext,  // ✅ Single source of truth
  };
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
  
  // ✅ Add reading status and get index
  const mergeIndex = await chatAPI.addReadingFile(filePath);
  
  try {
    // ✅ Check buffer first (uncommitted changes)
    const fileBuffers = state.fileBuffers || new Map();
    const buffered = fileBuffers.get(filePath);
    
    if (buffered && !buffered.committed) {
      console.log(`   📦 Reading from buffer: ${filePath}`);
      await chatAPI.addReadComplete(filePath, mergeIndex);
      return buffered.content;
    }
    
    // ✅ Read from disk
    const content = await gitPort.readFile(filePath);
    
    if (!content) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    console.log(`   💾 Read from disk: ${filePath} (${content.length} bytes)`);
    
    // ✅ UI notification: read complete (success)
    await chatAPI.addReadComplete(filePath, mergeIndex);
    
    return content;
  } catch (error) {
    // ✅ Update reading status with error message
    await chatAPI.addReadComplete(filePath, mergeIndex, (error as Error).message);
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
  
  const chatAPI = getChatAPIClient();
  
  // ✅ UI: Show listing_files status
  const listingIndex = await chatAPI.showChatStatus('listing_files', { 
    directory: directory || '.', 
    pattern 
  });
  
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
  
  // ✅ UI notification: listed_files complete
  await chatAPI.showChatStatus('listed_files', { 
    filesCount: filtered.length,
    totalFiles: items.length,
    pattern,
    filesList: filtered.slice(0, 20),
    _mergeIndex: listingIndex
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
  
  const chatAPI = getChatAPIClient();
  
  // ✅ UI: Show searching_code status
  const searchingIndex = await chatAPI.showChatStatus('searching_code', { 
    pattern, 
    file_pattern 
  });
  
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
  
  // ✅ UI notification: searched_code complete
  const matchedFiles = [...new Set(results.map(r => r.split(':')[0]))];
  await chatAPI.showChatStatus('searched_code', { 
    pattern,
    filesCount: matchedFiles.length,
    totalMatches: results.length,
    filesList: matchedFiles,
    _mergeIndex: searchingIndex
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
  
  // ✅ UI notification is handled by ChatService via tool_use event
  // No need to manually add tool_action here
  
  return `Directory created: ${dirPath}`;
}

/**
 * Handle run_command tool
 * 
 * Supports both:
 * - Short-lived commands (build, test, lint) - wait for completion
 * - Long-running commands (npm start, dev servers) - verify startup then terminate
 * 
 * Long-running behavior:
 * 1. Start the process
 * 2. Wait up to 10 seconds for startup
 * 3. If no error, consider it "started successfully"
 * 4. Terminate process and return success
 * 
 * This allows verification of "does the server start?" without hanging forever.
 */
async function handleRunCommand(
  state: ArchitectGraphState,
  args: { command: string; working_directory?: string; keep_running?: boolean }
): Promise<string> {
  const { command, working_directory, keep_running } = args;
  const commandPort = state.deps?.command;
  const gitPort = state.deps?.git;
  
  if (!commandPort) {
    throw new Error('CommandPort not available');
  }
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // ✅ UI: Show command_running status (loading card)
  const mergeIndex = await chatAPI.commandStart(command);
  
  // Detect long-running server commands
  const longRunningPatterns = [
    /npm\s+run\s+dev\b/,
    /npm\s+run\s+serve\b/,
    /npm\s+run\s+start\b/,  // npm run start
    /npm\s+start\b/,         // npm start (shorthand)
    /yarn\s+dev\b/,
    /yarn\s+serve\b/,
    /yarn\s+start\b/,
    /pnpm\s+dev\b/,
    /pnpm\s+serve\b/,
    /pnpm\s+start\b/,
    /node\s+.*server\.(js|ts)\b/,
    /tsx\s+.*server\.(js|ts)\b/,
    /nodemon\b/,
    /npx\s+vite\b/,
    /npx\s+next\s+dev\b/,
    /npx\s+react-scripts\s+start\b/
  ];
  
  const isLongRunning = longRunningPatterns.some(pattern => pattern.test(command));
  
  // Get project path
  const projectPath = await gitPort.getRepoRoot();
  const workingDir = working_directory 
    ? `${projectPath}/${working_directory}`
    : projectPath;
  
  console.log(`\n   🔧 Running command: ${command}`);
  console.log(`   📁 Working directory: ${workingDir}`);
  if (isLongRunning) {
    console.log(`   ⏱️  Long-running command detected - will verify startup (10s timeout)\n`);
  } else {
    console.log('');
  }
  
  let streamedStdout = '';
  let streamedStderr = '';
  
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Long-running command: verify startup, then terminate
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (isLongRunning && !keep_running) {
      const { spawn } = await import('child_process');
      
      return new Promise((resolve, reject) => {
        const child = spawn(command, {
          cwd: workingDir,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        let hasError = false;
        let resolved = false;  // ✅ Prevent double resolve/reject
        
        // ✅ Helper to safely resolve/reject once
        const safeResolve = async (message: string) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(startupTimeout);
          clearTimeout(earlyErrorTimeout);
          child.kill('SIGTERM');
          resolve(message);
        };
        
        const safeReject = async (error: Error) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(startupTimeout);
          clearTimeout(earlyErrorTimeout);
          child.kill('SIGTERM');
          reject(error);
        };
        
        child.stdout?.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          console.log(chunk);
          
          // ✅ Also check stdout for errors (some tools print to stdout)
          if (/error|Error|ERR_|EADDRINUSE|ENOENT|Cannot find|Transform failed|Unexpected/i.test(chunk)) {
            hasError = true;
          }
        });
        
        child.stderr?.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          console.error(chunk);
          
          // ✅ Check for common error patterns (case-insensitive)
          if (/error|Error|ERR_|EADDRINUSE|ENOENT|Cannot find|Transform failed|Unexpected|Exception/i.test(chunk)) {
            hasError = true;
          }
        });
        
        child.on('error', (err) => {
          hasError = true;
          stderr += err.message;
          console.error(`[ERROR] Process error: ${err.message}`);
        });
        
        // ✅ Early error detection: if error detected within 3 seconds, likely startup failure
        const earlyErrorTimeout = setTimeout(() => {
          if (hasError) {
            console.error(`\n   ❌ Early startup error detected (within 3s) - failing fast\n`);
            chatAPI.commandComplete(command, false, 1, `Early error:\n${stderr}\n${stdout}`, mergeIndex);
            safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Early startup failure detected (within 3 seconds).

Error output:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
          }
        }, 3000);
        
        // ✅ Wait 10 seconds for startup verification
        const startupTimeout = setTimeout(async () => {
          // If still running after 10s with no errors = success
          if (!hasError && child.exitCode === null) {
            console.log(`\n   ✅ Server started successfully (verified 10s startup)`);
            console.log(`   🛑 Terminating process (verification complete)\n`);
            
            await chatAPI.commandComplete(command, true, 0, 
              `Server started successfully.\n\nStartup output:\n${stdout}\n\n(Process terminated after verification)`,
              mergeIndex
            );
            
            safeResolve(`✅ SERVER STARTED SUCCESSFULLY: ${command}

The server started without errors. Process was terminated after 10 seconds of successful operation.

Startup output:
${stdout.slice(0, 2000)}${stdout.length > 2000 ? '\n...(truncated)' : ''}

Note: The server is NOT currently running. This was a startup verification test.`);
          } else if (hasError) {
            // ✅ If error detected but process still running after 10s, fail
            console.error(`\n   ❌ Error detected during startup - failing\n`);
            await chatAPI.commandComplete(command, false, 1, `Error:\n${stderr}\n${stdout}`, mergeIndex);
            safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Error detected during startup:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
          }
        }, 10000);
        
        child.on('exit', async (code, signal) => {
          const output = stdout + stderr;
          
          // ✅ Early exit (before 10s) is usually an error
          if (code === 0 && !hasError) {
            await chatAPI.commandComplete(command, true, 0, output, mergeIndex);
            safeResolve(`✅ Command completed: ${command}\n\nOutput:\n${output.slice(0, 3000)}`);
          } else {
            // ✅ Non-zero exit or detected error
            await chatAPI.commandComplete(command, false, code || 1, output, mergeIndex);
            safeReject(new Error(`❌ SERVER FAILED TO START: ${command}

Exit code: ${code || 'killed'}
Signal: ${signal || 'none'}

Error output:
${stderr.slice(0, 2000)}

Stdout:
${stdout.slice(0, 1000)}`));
          }
        });
      });
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Normal command: wait for completion
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    await chatAPI.commandComplete(command, success, exitCode, output, mergeIndex);
    
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
    await chatAPI.commandComplete(command, false, -1, errorMessage, mergeIndex);
    
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
    const searchResult = await state.deps.retriever.retrieve(
      query,
      refCodebasePath,
      { git: state.deps.git, vectorDB: state.deps.vectorDB },
      {
        maxFiles: Math.min(maxFiles, 10),  // Cap at 10
        maxTokens: 15000,  // Reasonable limit
        mode: state.codeMode || state.mode || 'generate'
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
    
    console.log(`   Retrieved ${searchResult.stats.filesLoaded} relevant files (${searchResult.stats.estimatedTokens} tokens)\n`);
    
    // 5. Update UI: Show search complete + explored files
    const filesList = searchResult.files?.map((f: any) => `[${project}] ${f.path}`) || [];
    
    await chatAPI.showChatStatus('searched_reference', {
      project: project,
      filesCount: searchResult.stats.filesLoaded
    });
    
    // ✅ Show explored files from reference project (with exploring first for proper merge)
    if (filesList.length > 0) {
      await chatAPI.showChatStatus('exploring', {
        filesCount: 0,
        totalFiles: 0
      });
      await chatAPI.showChatStatus('explored', {
        filesCount: searchResult.stats.filesLoaded,
        filesList: filesList
      });
    }
    
    // 6. Format result
    return `Retrieved ${searchResult.stats.filesLoaded} relevant file(s) in "${project}":

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

