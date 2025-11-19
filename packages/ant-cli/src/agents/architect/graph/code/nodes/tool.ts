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
import * as path from 'path';
import * as fs from 'fs';

export async function tool(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  console.log('\n🔧 [Tool] Executing tool...\n');
  
  // ✅ Get first tool call from llmResponse
  const toolCall = state.llmResponse?.toolCalls?.[0];
  
  if (!toolCall) {
    console.log('⚠️  [Tool] No tool call found, skipping');
    return {};
  }
  
  const { id, name, args } = toolCall;
  
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
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'tool', taskInfo);
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
  
  // ✅ Build tool result content (Anthropic format)
  const toolResultContent = error 
    ? `Error: ${error}`
    : typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  
  // ✅ Update conversation history
  const newHistory = [
    ...(state.conversationHistory || []),
    // Assistant's tool call
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
    // User's tool result
    {
      role: 'user' as const,
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: toolResultContent,
        },
      ],
    },
  ];
  
  // ✅ Remove processed tool call
  const remainingToolCalls = state.llmResponse?.toolCalls?.slice(1) || [];
  
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
  
  // ✅ 1. IMMEDIATELY write to project disk (점진적 저장!)
  await gitPort.writeFile(filePath, content);
  console.log(`   💾 ${actionType === 'create' ? 'Created' : 'Modified'}: ${filePath} (${content.length} bytes)`);
  console.log(`   ✅ Saved to disk IMMEDIATELY (true incremental saving)`);
  
  // ✅ 2. Update buffer in state (for tracking & potential rollback)
  const fileBuffers = state.fileBuffers || new Map();
  fileBuffers.set(filePath, {
    path: filePath,
    content,
    actionType,
    committed: true,  // Already committed to disk!
  });
  
  // ✅ 3. UI notification
  const chatAPI = getChatAPIClient();
  if (actionType === 'create') {
    await chatAPI.completeFileCreation(filePath, content);
  } else {
    const existingContent = exists ? await gitPort.readFile(filePath) : '';
    await chatAPI.startFileEdit(filePath);
    await chatAPI.completeFileEdit(filePath, existingContent || '', content);
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
  
  // ✅ Check buffer first (uncommitted changes)
  const fileBuffers = state.fileBuffers || new Map();
  const buffered = fileBuffers.get(filePath);
  
  if (buffered && !buffered.committed) {
    console.log(`   📦 Reading from buffer: ${filePath}`);
    return buffered.content;
  }
  
  // ✅ Read from disk
  const content = await gitPort.readFile(filePath);
  
  if (!content) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  console.log(`   💾 Read from disk: ${filePath} (${content.length} bytes)`);
  
  return content;
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
  
  const repoRoot = await gitPort.getRepoRoot();
  const targetDir = path.join(repoRoot, directory);
  
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Directory not found: ${directory}`);
  }
  
  const files = fs.readdirSync(targetDir);
  
  // Filter by pattern if provided
  const filtered = pattern 
    ? files.filter(f => f.includes(pattern))
    : files;
  
  console.log(`   📁 Listed ${filtered.length} files in ${directory}`);
  
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
  
  const repoRoot = await gitPort.getRepoRoot();
  
  // Simple file search (fallback - ideally use ripgrep)
  const results: string[] = [];
  const files = getAllFiles(repoRoot, file_pattern);
  
  for (const file of files.slice(0, 50)) {  // Limit to 50 files
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      if (line.includes(pattern)) {
        const relativePath = path.relative(repoRoot, file);
        results.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  
  console.log(`   🔍 Found ${results.length} matches for "${pattern}"`);
  
  return results.join('\n');
}

/**
 * Get temp file path for buffering
 */
function getTempFilePath(state: ArchitectGraphState, filePath: string): string {
  const jobId = state._httpJobId || 'unknown';
  const safeFilePath = filePath.replace(/\//g, '_');
  return path.join('/tmp', `ant-buffer-${jobId}-${safeFilePath}`);
}

/**
 * Ensure directory exists
 */
function ensureDirectoryExists(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get all files recursively
 */
function getAllFiles(dir: string, pattern?: string): string[] {
  const results: string[] = [];
  
  function walk(currentDir: string) {
    const files = fs.readdirSync(currentDir);
    
    for (const file of files) {
      const filePath = path.join(currentDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        if (!file.startsWith('.') && file !== 'node_modules') {
          walk(filePath);
        }
      } else {
        if (!pattern || file.includes(pattern)) {
          results.push(filePath);
        }
      }
    }
  }
  
  walk(dir);
  return results;
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
  
  // Get project path
  const projectPath = await gitPort.getRepoRoot();
  const workingDir = working_directory 
    ? `${projectPath}/${working_directory}`
    : projectPath;
  
  console.log(`\n   🔧 Running command: ${command}`);
  console.log(`   📁 Working directory: ${workingDir}\n`);
  
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;
  
  // Execute command with streaming output
  await commandPort.execute(command, {
    cwd: workingDir,
    onStdout: (chunk: string) => {
      stdout += chunk;
      console.log(chunk);
    },
    onStderr: (chunk: string) => {
      stderr += chunk;
      console.error(chunk);
    },
    onExit: (code: number) => {
      exitCode = code;
    },
  });
  
  const success = exitCode === 0;
  const output = stdout + stderr;
  
  if (success) {
    console.log(`\n   ✅ Command succeeded (exit code: ${exitCode})\n`);
  } else {
    console.error(`\n   ❌ Command failed (exit code: ${exitCode})\n`);
  }
  
  return JSON.stringify({
    success,
    command,
    working_directory: workingDir,
    stdout,
    stderr,
    exitCode,
    message: success 
      ? `Command executed successfully: ${command}`
      : `Command failed with exit code ${exitCode}: ${command}`,
  }, null, 2);
}

