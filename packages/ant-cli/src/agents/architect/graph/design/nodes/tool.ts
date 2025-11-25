/**
 * Tool Node (Design Job) - 단일 도구 실행
 * 
 * NOTE: Code job의 tool 노드와 거의 동일하지만 DesignGraphState 사용
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../core/utils/toolResultManager';

// ✅ Initialize tool result manager (singleton for consistency)
const tokenManager = new TokenBudgetManager();
const toolResultManager = new ToolResultManager(tokenManager);

export async function tool(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
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
      (state as any).recursionCount,  // ✅ Optional: design job doesn't have recursion tracking
      (state as any).recursionLimit
    );
  }
  
  // ✅ CRITICAL: Give UI time to render file card from tool_use event
  // This ensures smooth loading → complete animation for ALL files, not just the first one
  // Why needed:
  // - First file: LLM thinking provides natural delay → UI has time → animation works ✅
  // - Subsequent files: No thinking (disabled) → tool executes immediately → card rendered as completed ❌
  // - Solution: Intentional 150ms delay for UI card creation (NOT a hack, it's for UX consistency)
  if (name === 'write_file' || name === 'delete_file') {
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
  
  // ✅ Workflow instrumentation: Exit node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool');
  }
  
  return {
    conversationHistory: newHistory,
    files: state.files,  // Updated by handleWriteFile
  };
}

/**
 * Handle write_file tool
 * ✅ NEW: 버퍼 우선 처리 - content가 없거나 빈 문자열이면 버퍼에서 읽음
 */
async function handleWriteFile(
  state: DesignGraphState,
  args: { path: string; content?: string; useBuffer?: boolean }
): Promise<string> {
  const { path: filePath, useBuffer } = args;
  let { content } = args;
  
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // ✅ 1. 버퍼 우선 처리
  const bufferManager = state._bufferManager;
  
  if (useBuffer || !content || content.trim() === '') {
    if (!bufferManager) {
      throw new Error('BufferManager not available');
    }
    
    const bufferedContent = bufferManager.getContent(filePath);
    
    if (bufferedContent) {
      console.log(`📝 [Tool] Using buffered content for ${filePath} (${bufferedContent.length} chars)`);
      content = bufferedContent;
      
      // ✅ 버퍼 사용 후 정리
      bufferManager.completeFile(filePath, true);  // cleanup = true
    } else if (!content) {
      throw new Error(`No content provided and no buffer found for ${filePath}`);
    }
  }
  
  // ✅ CRITICAL: Convert relative path to absolute path for design outputs
  // Design files (outputs/design/*.md) should be saved in features/{feature}/outputs/design
  // NOT in codebase/outputs/design
  const path = await import('path');
  let absolutePath = filePath;
  
  if (!path.isAbsolute(filePath)) {
    // Relative path: resolve to feature directory
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context. Ensure resolve node has run.');
    }
    absolutePath = path.join(featurePath, filePath);
    console.log(`📍 [Tool] Resolved path: ${filePath} → ${absolutePath}`);
  }
  
  // Determine action type
  const exists = await gitPort.fileExists(absolutePath);
  const actionType = exists ? 'edit' : 'create';
  
  // ✅ 2. Read existing content BEFORE writing (for diff) - with error handling
  let existingContent = '';
  if (exists) {
    try {
      existingContent = await gitPort.readFile(absolutePath) || '';
    } catch (readError) {
      // If read fails, continue with empty diff (file write is more important!)
      console.warn(`⚠️  Failed to read existing content for diff: ${(readError as Error).message}`);
      existingContent = '';
    }
  }
  
  // ✅ 3. IMMEDIATELY write to project disk (using absolute path)
  await gitPort.writeFile(absolutePath, content);
  console.log(`   💾 ${actionType === 'create' ? 'Created' : 'Modified'}: ${absolutePath} (${content.length} bytes)`);
  
  // ✅ 4. Update state.files (use relative path for consistency)
  const files = state.files || [];
  const existingFileIndex = files.findIndex(f => f.path === filePath);
  if (existingFileIndex !== -1) {
    files[existingFileIndex] = { path: filePath, content };
  } else {
    files.push({ path: filePath, content });
  }
  state.files = files;
  
  // ✅ 5. UI notification (use relative path for display)
  if (actionType === 'create') {
    await chatAPI.completeFileCreation(filePath, content);
  } else {
    await chatAPI.startFileEdit(filePath);
    await chatAPI.completeFileEdit(filePath, existingContent, content);
  }
  
  return `File ${filePath} ${actionType === 'create' ? 'created' : 'updated'} (${content.length} bytes)`;
}

/**
 * Handle read_file tool
 */
async function handleReadFile(
  state: DesignGraphState,
  args: { path: string }
): Promise<string> {
  const { path: filePath } = args;
  const gitPort = state.deps?.git;
  const chatAPI = getChatAPIClient();
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Convert relative path to absolute path for design outputs
  const path = await import('path');
  let absolutePath = filePath;
  
  if (!path.isAbsolute(filePath)) {
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context');
    }
    absolutePath = path.join(featurePath, filePath);
  }
  
  try {
    const content = await gitPort.readFile(absolutePath);
    if (!content) {
      throw new Error(`File not found or empty: ${filePath}`);
    }
    
    console.log(`   📖 Read: ${absolutePath} (${content.length} bytes)`);
    
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
 * Handle list_files tool
 */
async function handleListFiles(
  state: DesignGraphState,
  args: { directory?: string; pattern?: string }
): Promise<string> {
  const { directory, pattern } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Convert relative directory path to absolute path for design job
  const path = await import('path');
  let absoluteDir = directory || '.';
  
  if (!path.isAbsolute(absoluteDir)) {
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context');
    }
    absoluteDir = path.join(featurePath, absoluteDir);
  }
  
  const files = await gitPort.listFiles(absoluteDir, [
    'node_modules',
    '.git',
    'dist',
    'build',
  ]);
  
  // ✅ Note: listFiles returns only files (not directories) recursively
  // For non-recursive listing with directories, we'd use readDirectory
  // But since this is used for code exploration, files-only is appropriate
  
  // Filter by pattern if provided
  const filteredFiles = pattern 
    ? files.filter(f => f.includes(pattern))
    : files;
  
  console.log(`   📂 Listed: ${filteredFiles.length} files in ${directory || '.'}`);
  
  // ✅ UI notification: exploration complete
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('explored', { 
    filesCount: filteredFiles.length,
    filesList: filteredFiles 
  });
  
  return JSON.stringify({
    directory: directory || '.',
    pattern,
    files: filteredFiles,
    count: filteredFiles.length,
  }, null, 2);
}

/**
 * Handle search_code tool
 */
async function handleSearchCode(
  state: DesignGraphState,
  args: { pattern: string; file_pattern?: string }
): Promise<string> {
  const { pattern, file_pattern } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Convert relative path to absolute path for design job
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  const absoluteDir = path.join(featurePath, '.');
  
  // Simple search implementation
  const files = await gitPort.listFiles(absoluteDir, ['node_modules', '.git']);
  const results: any[] = [];
  
  for (const file of files.slice(0, 50)) {
    if (file_pattern && !file.includes(file_pattern)) continue;
    
    try {
      const content = await gitPort.readFile(file);
      if (!content) continue;
      
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes(pattern)) {
          results.push({
            file,
            line: idx + 1,
            snippet: line.trim(),
          });
        }
      });
      
      if (results.length >= 50) break;
    } catch {
      // Skip files that can't be read
    }
  }
  
  console.log(`   🔍 Search: "${pattern}" found ${results.length} results`);
  
  // ✅ UI notification: search complete
  const chatAPI = getChatAPIClient();
  const matchedFiles = [...new Set(results.map(r => r.file))];
  await chatAPI.showChatStatus('explored', { 
    filesCount: matchedFiles.length,
    filesList: matchedFiles 
  });
  
  return JSON.stringify({
    pattern,
    file_pattern,
    results: results.slice(0, 50),
    count: results.length,
  }, null, 2);
}

/**
 * Handle delete_file tool
 */
async function handleDeleteFile(
  state: DesignGraphState,
  args: { path: string }
): Promise<string> {
  const { path: filePath } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  
  // ✅ Convert relative path to absolute path for design outputs
  const path = await import('path');
  let absolutePath = filePath;
  
  if (!path.isAbsolute(filePath)) {
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context');
    }
    absolutePath = path.join(featurePath, filePath);
  }
  
  const exists = await gitPort.fileExists(absolutePath);
  if (!exists) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  
  await gitPort.deleteFile(absolutePath);
  console.log(`   🗑️  Deleted: ${absolutePath}`);
  
  await chatAPI.completeFileDeletion(filePath);
  
  // ✅ Update state.files (use relative path)
  state.files = (state.files || []).filter(f => f.path !== filePath);
  
  return `File deleted successfully: ${filePath}`;
}

/**
 * Handle mkdir tool
 */
async function handleMkdir(
  state: DesignGraphState,
  args: { path: string }
): Promise<string> {
  const { path: dirPath } = args;
  const gitPort = state.deps?.git;
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  // ✅ Convert relative path to absolute path for design outputs
  const path = await import('path');
  let absolutePath = dirPath;
  
  if (!path.isAbsolute(dirPath)) {
    const featurePath = state.context.featurePath;
    if (!featurePath) {
      throw new Error('featurePath not available in context');
    }
    absolutePath = path.join(featurePath, dirPath);
  }
  
  await gitPort.createDirectory(absolutePath);
  console.log(`   📁 Created directory: ${absolutePath}`);
  
  return `Directory created: ${dirPath}`;
}

