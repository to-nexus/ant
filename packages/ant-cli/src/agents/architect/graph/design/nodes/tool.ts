/**
 * Tool Node (Design Job) - 단일 도구 실행
 * 
 * NOTE: Code job의 tool 노드와 거의 동일하지만 DesignGraphState 사용
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';

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
  
  // Determine action type
  const exists = await gitPort.fileExists(filePath);
  const actionType = exists ? 'edit' : 'create';
  
  // ✅ 2. IMMEDIATELY write to project disk
  await gitPort.writeFile(filePath, content);
  console.log(`   💾 ${actionType === 'create' ? 'Created' : 'Modified'}: ${filePath} (${content.length} bytes)`);
  
  // ✅ 3. Update state.files
  const files = state.files || [];
  const existingFileIndex = files.findIndex(f => f.path === filePath);
  if (existingFileIndex !== -1) {
    files[existingFileIndex] = { path: filePath, content };
  } else {
    files.push({ path: filePath, content });
  }
  state.files = files;
  
  // ✅ 4. UI notification
  if (actionType === 'create') {
    await chatAPI.completeFileCreation(filePath, content);
  } else {
    const existingContent = exists ? await gitPort.readFile(filePath) : '';
    await chatAPI.startFileEdit(filePath);
    await chatAPI.completeFileEdit(filePath, existingContent || '', content);
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
  
  if (!gitPort) {
    throw new Error('GitPort not available');
  }
  
  const content = await gitPort.readFile(filePath);
  if (!content) {
    throw new Error(`File not found or empty: ${filePath}`);
  }
  
  console.log(`   📖 Read: ${filePath} (${content.length} bytes)`);
  
  // ✅ UI notification: read complete
  const chatAPI = getChatAPIClient();
  await chatAPI.addReadComplete(filePath);
  
  return content;
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
  
  const files = await gitPort.listFiles(directory || '.', [
    'node_modules',
    '.git',
    'dist',
    'build',
  ]);
  
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
  
  // Simple search implementation
  const files = await gitPort.listFiles('.', ['node_modules', '.git']);
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
  
  const exists = await gitPort.fileExists(filePath);
  if (!exists) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  
  await gitPort.deleteFile(filePath);
  console.log(`   🗑️  Deleted: ${filePath}`);
  
  await chatAPI.completeFileDeletion(filePath);
  
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
  
  await gitPort.createDirectory(dirPath);
  console.log(`   📁 Created directory: ${dirPath}`);
  
  return `Directory created: ${dirPath}`;
}

