/**
 * Tool Node (Design Job) - 도구 실행 (배치 지원)
 * 
 * NOTE: Code job의 tool 노드와 거의 동일하지만 DesignGraphState 사용
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../core/utils/toolResultManager';
import { executeSearchWeb } from '../../../tools/searchWeb';
import { getExecutionLogger } from '../../../../../core/utils/executionLogger';
import { FigmaRateLimitError } from '../../../../../periphery/adapters/figma/errors';
import { callFigmaMCPTool, isFigmaImageResult, isFigmaCompositeResult, saveFigmaScreenshot } from '../../../tools/figmaMCPHandler';
import type { FigmaMCPResult } from '../../../tools/figmaMCPHandler';

const tokenManager = new TokenBudgetManager();
const toolResultManager = new ToolResultManager(tokenManager, {
  maxReadFileTokens: 15000,
  maxSourceDocTokens: 15000,
});

const CACHEABLE_TOOLS = new Set(['read_source_doc', 'read_file', 'search_code', 'list_files', 'list_reference_images', 'list_assets']);

/**
 * Execute a single design tool and return its result content (Anthropic format)
 */
async function executeDesignTool(
  name: string,
  state: DesignGraphState,
  args: Record<string, any>
): Promise<{ result: any; error?: string; toolResultContent: any }> {
  // Check cache for read-only tools
  if (CACHEABLE_TOOLS.has(name) && state._toolResultCache) {
    const cacheKey = `${name}:${JSON.stringify(args)}`;
    const cached = state._toolResultCache[cacheKey];
    if (cached !== undefined) {
      console.log(`♻️  [Tool] Cache hit: ${name}(${JSON.stringify(args).substring(0, 80)})`);
      return { result: cached, error: undefined, toolResultContent: `[Cached result — same as previous call]\n\n${cached}` };
    }
  }

  let result: any;
  let error: string | undefined;

  try {
    switch (name) {
      case 'read_file':
        result = await handleReadFile(state, args as { path: string; startLine?: number; endLine?: number });
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
      case 'read_reference_image':
        result = await handleReadReferenceImage(state, args as any);
        break;
      case 'list_reference_images':
        result = await handleListReferenceImages(state, args as any);
        break;
      case 'list_assets':
        result = await handleListAssets(state, args as any);
        break;
      case 'search_web':
        result = await executeSearchWeb(args as { query: string });
        break;
      case 'read_source_doc': {
        const { filename, startLine, endLine } = args as { filename: string; startLine?: number; endLine?: number };
        const chatAPI = getChatAPIClient();
        const readIdx = await chatAPI.addReadingSource(filename, startLine, endLine);
        result = handleReadSourceFileFromState(state, { filename, startLine, endLine });
        const totalMatch = typeof result === 'string' ? result.match(/of (\d+)\]/) : null;
        const totalLines = totalMatch ? Number(totalMatch[1]) : undefined;
        const isError = typeof result === 'string' && result.startsWith('Error:');
        await chatAPI.addReadSourceComplete(filename, readIdx, {
          error: isError ? result : undefined,
          startLine, endLine, totalLines,
        });
        break;
      }
      case 'figma_get_metadata':
      case 'figma_get_design_context':
      case 'figma_get_screenshot':
      case 'figma_get_variable_defs': {
        const figmaChatAPI = getChatAPIClient();
        const figmaNodeId = (args as any).nodeId as string | undefined;
        const figmaNodeName = figmaNodeId
          ? state.figmaExplorationResult?.nodeSummary?.find(n => n.nodeId === figmaNodeId)?.name
          : undefined;
        const figmaStatusMeta = { toolName: name, nodeId: figmaNodeId, nodeName: figmaNodeName };
        const figmaMergeIdx = await figmaChatAPI.showChatStatus('figma_calling', figmaStatusMeta);
        try {
          const figmaArgs = args as { fileKey: string; nodeId: string };
          const mcpResult: FigmaMCPResult = await callFigmaMCPTool(
            { userId: state.context?.userId, redis: state.deps?.redis, taskId: (state.currentTask as any)?.id },
            name, figmaArgs.fileKey, figmaArgs.nodeId,
          );

          // Save supplementary image (from screenshot or design_context) for chat preview
          let imagePath: string | undefined;
          const imageData = isFigmaImageResult(mcpResult)
            ? mcpResult
            : isFigmaCompositeResult(mcpResult) ? mcpResult.image : null;
          if (imageData && state.context?.featurePath && figmaArgs.nodeId) {
            try {
              imagePath = await saveFigmaScreenshot(state.context.featurePath, figmaArgs.nodeId, imageData.base64, imageData.mimeType);
            } catch { /* non-critical: preview unavailable */ }
          }
          await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, imagePath, _mergeIndex: figmaMergeIdx });

          if (isFigmaImageResult(mcpResult)) {
            result = { __figmaImage: true, base64: mcpResult.base64, mimeType: mcpResult.mimeType };
          } else if (isFigmaCompositeResult(mcpResult)) {
            const isRootNode = figmaNodeId === '0:1' || figmaNodeId === '0-1';
            const hasSummary = (state.figmaExplorationResult?.nodeSummary?.length ?? 0) > 0;
            if (isRootNode && hasSummary && name !== 'figma_get_screenshot') {
              result = buildRootCallGuidance(state, name);
            } else {
              result = {
                __figmaComposite: true,
                text: mcpResult.text,
                base64: mcpResult.image.base64,
                mimeType: mcpResult.image.mimeType,
              };
            }
          } else {
            result = mcpResult;
            if ((figmaNodeId === '0:1' || figmaNodeId === '0-1') && result && name !== 'figma_get_screenshot') {
              const hasSummary = (state.figmaExplorationResult?.nodeSummary?.length ?? 0) > 0;
              if (hasSummary) {
                result = buildRootCallGuidance(state, name);
              }
            }
          }
        } catch (err: any) {
          if (err instanceof FigmaRateLimitError) throw err;
          await figmaChatAPI.showChatStatus('figma_called', { ...figmaStatusMeta, error: true, _mergeIndex: figmaMergeIdx });
          result = JSON.stringify({ error: err.message });
        }
        break;
      }
      case 'download_asset': {
        const dlChatAPI = getChatAPIClient();
        const dlFilename = (args as any).filename || 'asset';
        const dlMergeIdx = await dlChatAPI.showChatStatus('downloading', { filename: dlFilename });
        try {
          result = await handleDownloadAsset(state, args as { url: string; filename: string; category?: string });
          const parsed = typeof result === 'string' ? JSON.parse(result) : result;
          const sizeKB = parsed?.sizeBytes ? (parsed.sizeBytes / 1024).toFixed(1) : undefined;
          const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(parsed?.path || '');
          await dlChatAPI.showChatStatus('downloaded', {
            filename: dlFilename, sizeKB, _mergeIndex: dlMergeIdx,
            ...(isImage && parsed?.path ? { imagePath: parsed.path } : {}),
          });
        } catch (err: any) {
          await dlChatAPI.showChatStatus('downloaded', { filename: dlFilename, error: true, _mergeIndex: dlMergeIdx });
          result = JSON.stringify({ error: err.message });
        }
        break;
      }
      case 'append_file':
      case 'write_file': {
        // LLM hallucination recovery: append_file/write_file → fileSystem operations
        const isAppend = name === 'append_file';
        const { path: filePath, content } = args as { path: string; content: string };
        if (!content) {
          throw new Error(`${name} called without content. Use ${isAppend ? '<append>' : '<file>'} XML tag instead.`);
        }
        result = await handleHallucinatedFileWrite(state, filePath, content, isAppend);
        console.warn(`⚠️  [Tool] LLM hallucinated ${name} → auto-converted to file ${isAppend ? 'append' : 'write'} for ${filePath}`);
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    console.log(`✅ [Tool] ${name} executed successfully (args: ${JSON.stringify(args)})`);
    const isImg = result && typeof result === 'object' && (result.__figmaImage || result.__figmaComposite || result.type === 'image');
    const resultPreview = isImg
      ? (result.__figmaComposite
        ? `[composite: text ${(result as any).text?.length ?? 0} chars + image ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`
        : `[image: ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`)
      : (typeof result === 'string'
        ? result.substring(0, 200)
        : JSON.stringify(result, null, 2).substring(0, 200));
    console.log(`   Result: ${resultPreview}...`);
  } catch (e) {
    if (e instanceof FigmaRateLimitError) throw e;
    error = (e as Error).message;
    console.error(`❌ [Tool] ${name} execution failed:`, error);
  }

  // Build tool result content (handles image multimodal)
  let toolResultContent: any;
  let truncationInfo: { wasTruncated: boolean; originalTokens: number; truncatedTokens: number } | undefined;

  if (name === 'read_reference_image' && result && typeof result === 'object' && result.type === 'image') {
    const imageData = result as { type: 'image'; path: string; base64: string; mediaType: string };
    toolResultContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mediaType,
          data: imageData.base64,
        },
      },
      {
        type: 'text',
        text: `✅ Image loaded: ${imageData.path}\n\nAnalyze the visual elements above for design token extraction, component specifications, or layout analysis as needed for your current task.`,
      },
    ];
    console.log(`   🖼️  Multimodal: Image added to conversation (${Math.round(imageData.base64.length / 1024)}KB base64)`);
  } else if (result && typeof result === 'object' && result.__figmaImage) {
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
  } else if (result && typeof result === 'object' && result.__figmaComposite) {
    const comp = result as { __figmaComposite: true; text: string; base64: string; mimeType: string };
    const isFigmaTool = name.startsWith('figma_');
    const figmaContext = isFigmaTool ? { queriedNodeId: args.nodeId, nodeSummary: state.figmaExplorationResult?.nodeSummary } : undefined;
    const truncation = toolResultManager.truncateResult(name, comp.text, error, undefined, figmaContext);
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
    truncationInfo = { wasTruncated: truncation.wasTruncated, originalTokens: truncation.originalTokens, truncatedTokens: truncation.truncatedTokens };
    if (truncation.wasTruncated) {
      console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    }
    console.log(`   🖼️  Multimodal: Figma design context + screenshot (${Math.round(comp.base64.length / 1024)}KB ${comp.mimeType})`);
  } else {
    const toolFilePath = args.path || args.filename;
    const isFigmaTool = name.startsWith('figma_');
    const figmaContext = isFigmaTool ? {
      queriedNodeId: args.nodeId,
      nodeSummary: state.figmaExplorationResult?.nodeSummary,
    } : undefined;
    const truncation = toolResultManager.truncateResult(name, result, error, toolFilePath, figmaContext);
    toolResultContent = truncation.content;
    truncationInfo = { wasTruncated: truncation.wasTruncated, originalTokens: truncation.originalTokens, truncatedTokens: truncation.truncatedTokens };
    if (truncation.wasTruncated) {
      console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    }
  }

  // Log tool call to execution logger
  const jobId = state._httpJobId;
  const featurePath = state.context?.featurePath;
  const taskId = (state.currentTask as any)?.id;
  if (jobId && featurePath && taskId) {
    try {
      const logger = getExecutionLogger({ featurePath, jobId, jobType: 'design' });
      const isImageResult = result && typeof result === 'object' && (result.__figmaImage || result.__figmaComposite || result.type === 'image');
      const resultStr = isImageResult
        ? (result.__figmaComposite
          ? `[composite: text ${(result as any).text?.length ?? 0} chars + image ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`
          : `[image: ${Math.round(((result as any).base64?.length ?? 0) / 1024)}KB]`)
        : (typeof result === 'string' ? result : JSON.stringify(result ?? ''));
      await logger.logToolCall(taskId, {
        toolName: name,
        args,
        resultChars: resultStr.length,
        resultPreview: isImageResult ? resultStr : (resultStr.length <= 500 ? resultStr : undefined),
        wasTruncated: truncationInfo?.wasTruncated ?? false,
        originalTokens: truncationInfo?.originalTokens,
        truncatedTokens: truncationInfo?.truncatedTokens,
        error,
      });
    } catch { /* non-blocking */ }
  }

  // Store in cache for read-only tools (cache the truncated content the LLM sees)
  if (CACHEABLE_TOOLS.has(name) && !error && typeof toolResultContent === 'string') {
    if (!state._toolResultCache) state._toolResultCache = {};
    const cacheKey = `${name}:${JSON.stringify(args)}`;
    state._toolResultCache[cacheKey] = toolResultContent;
  }

  return { result, error, toolResultContent };
}

export async function tool(
  state: DesignGraphState
): Promise<Partial<DesignGraphState>> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  const toolCalls = state.llmResponse?.toolCalls || [];

  if (toolCalls.length === 0) {
    return {};
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

  // Execute ALL tool calls sequentially
  const toolUseBlocks: any[] = [];
  const toolResultBlocks: any[] = [];

  console.log(`🔧 [Tool] Executing ${toolCalls.length} tool call(s)`);

  for (const tc of toolCalls) {
    const { id, name, args } = tc;
    console.log(`🔧 [Tool] ${name}`);

    if (name === 'delete_file') {
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    const { toolResultContent } = await executeDesignTool(name, state, args);

    toolUseBlocks.push({ type: 'tool_use', id, name, input: args });
    toolResultBlocks.push({ type: 'tool_result', tool_use_id: id, content: toolResultContent });
  }

  // Build batch conversation history (Anthropic multi-tool format)
  // Preserve thinking blocks so the API accepts thinking on subsequent turns.
  // The signature field is required by the Anthropic API to validate unmodified thinking blocks.
  const assistantContent: any[] = [];
  if (state.llmResponse?.thinking) {
    assistantContent.push({
      type: 'thinking' as const,
      thinking: state.llmResponse.thinking,
      signature: state.llmResponse.thinkingSignature || '',
    });
  }
  assistantContent.push(...toolUseBlocks);

  const newHistory = [
    ...(state.conversationHistory || []),
    { role: 'assistant' as const, content: assistantContent },
    { role: 'user' as const, content: toolResultBlocks },
  ];

  // Workflow: exit once per batch
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', (state as any).workerId ?? 0);
  }

  return {
    conversationHistory: newHistory,
    files: state.files,
    _currentTaskTokenUsage: state._currentTaskTokenUsage,
    tokenUsage: (state as any).tokenUsage,
    _toolResultCache: state._toolResultCache,
    llmResponse: {
      ...state.llmResponse!,
      toolCalls: [],
    },
  };
}

/**
 * Handle read_file tool with optional line range support.
 * Without startLine/endLine: returns full content (may be truncated by ToolResultManager).
 * With startLine/endLine: returns the specified line range with a header.
 */
async function handleReadFile(
  state: DesignGraphState,
  args: { path: string; startLine?: number; endLine?: number }
): Promise<string> {
  const { path: filePath, startLine, endLine } = args;
  const fileSystem = state.deps?.fileSystem;
  const chatAPI = getChatAPIClient();
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  const mergeIndex = await chatAPI.addReadingFile(filePath);
  
  try {
    const content = await fileSystem.readFile(relativePath);
    if (!content) {
      throw new Error(`File not found or empty: ${filePath}`);
    }
    
    console.log(`   📖 Read: ${relativePath} (${content.length} bytes)`);
    
    await chatAPI.addReadComplete(filePath, mergeIndex);

    if (startLine || endLine) {
      const lines = content.split('\n');
      const totalLines = lines.length;
      const start = Math.max(1, startLine || 1);
      const end = Math.min(totalLines, endLine || totalLines);
      const slice = lines.slice(start - 1, end).join('\n');
      return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
    }
    
    return content;
  } catch (error) {
    await chatAPI.addReadComplete(filePath, mergeIndex, (error as Error).message);
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
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build absolute path
  const absoluteDir = path.isAbsolute(directory || '.')
    ? (directory || '.')
    : path.join(featurePath, directory || '.');
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absoluteDir)
    : absoluteDir.replace(/^\//, '');
  
  const files = await fileSystem.listFiles(relativePath, [
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
  
  // ✅ UI notification: grepping complete (local file list) — skip if 0 results
  if (filteredFiles.length > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: filteredFiles.length,
      filesList: filteredFiles,
      _mergeIndex: mergeIndex
    });
  }
  
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
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, featurePath)
    : featurePath.replace(/^\//, '');
  
  // Simple search implementation using workspace-relative paths
  const files = await fileSystem.listFiles(relativePath, ['node_modules', '.git']);
  const results: any[] = [];
  
  for (const file of files.slice(0, 50)) {
    if (file_pattern && !file.includes(file_pattern)) continue;
    
    try {
      // ✅ files are already workspace-relative from listFiles
      const content = await fileSystem.readFile(file);
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
  
  // ✅ UI notification: search complete — skip if 0 results
  const matchedFiles = [...new Set(results.map(r => r.file))];
  if (matchedFiles.length > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: matchedFiles.length,
      filesList: matchedFiles,
      _mergeIndex: mergeIndex
    });
  }
  
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
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const chatAPI = getChatAPIClient();
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build absolute path for logging
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  const exists = await fileSystem.fileExists(relativePath);
  if (!exists) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  
  await fileSystem.deleteFile(relativePath);
  console.log(`   🗑️  Deleted: ${relativePath}`);
  
  await chatAPI.completeFileDeletion(filePath);
  
  // ✅ Update state.files (use relative path)
  state.files = (state.files || []).filter(f => f.path !== filePath);
  
  return `File deleted successfully: ${filePath}`;
}

/**
 * Handle edit_file tool (Design job)
 */
async function handleEditFile(
  state: DesignGraphState,
  args: { path: string; old_str: string; new_str: string }
): Promise<string> {
  const { path: filePath, old_str, new_str } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  if (!filePath || old_str === undefined || new_str === undefined) {
    throw new Error('edit_file requires path, old_str, and new_str');
  }
  
  const chatAPI = getChatAPIClient();
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build absolute path for logging
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  // ✅ Start file edit UI notification
  await chatAPI.startFileEdit(filePath);
  
  try {
    // ✅ Check if file exists
    const exists = await fileSystem.fileExists(relativePath);
    if (!exists) {
      throw new Error(`File does not exist: ${filePath}. Use <file> tag to create new files.`);
    }
    
    // ✅ Read current file content (always from disk to ensure latest state)
    const originalContent = await fileSystem.readFile(relativePath);
    if (!originalContent) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
    
    // ✅ Apply search/replace using existing logic
    const { applySearchReplace } = await import('../../../../../core/streaming/strategies/common/EditOperations');
    const modifiedContent = applySearchReplace(
      originalContent,
      old_str,
      new_str,
      filePath
    );
    
    // ✅ Write modified content back to disk
    await fileSystem.writeFile(relativePath, modifiedContent);
    
    console.log(`✅ [EditFile] Successfully edited ${relativePath}`);
    console.log(`   Replaced ${old_str.length} chars with ${new_str.length} chars`);
    
    // ✅ Notify file tree update after disk write
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);
      
      // ✅ Add unseen artifact notification for design files
      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate && filePath.startsWith('outputs/')) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [filePath]
        );
      }
    }
    
    // ✅ UI notification: file edit complete
    await chatAPI.completeFileEdit(filePath, old_str, new_str);
    
    return `File edited successfully: ${filePath}\nReplaced ${old_str.length} characters with ${new_str.length} characters.`;
  } catch (error) {
    // ✅ UI notification: file edit failed
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}

/**
 * Handle mkdir tool
 */
async function handleMkdir(
  state: DesignGraphState,
  args: { path: string }
): Promise<string> {
  const { path: dirPath } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build absolute path for logging
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(featurePath, dirPath);
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  await fileSystem.createDirectory(relativePath);
  console.log(`   📁 Created directory: ${relativePath}`);
  
  return `Directory created: ${dirPath}`;
}

/**
 * Handle read_source_doc tool — reads from in-memory sourceDocuments.
 * Supports optional startLine/endLine for selective reading of large documents.
 */
function handleReadSourceFileFromState(
  state: DesignGraphState,
  args: { filename: string; startLine?: number; endLine?: number }
): string {
  const { filename, startLine, endLine } = args;
  const docs = state.sourceDocuments;
  if (!docs || !docs[filename]) {
    const available = docs ? Object.keys(docs).join(', ') : 'none';
    return `Error: File "${filename}" not found. Available: ${available}`;
  }

  const content = docs[filename];
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (startLine || endLine) {
    const start = Math.max(1, startLine || 1);
    const end = Math.min(totalLines, endLine || totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
  }

  return `[Total: ${totalLines} lines]\n\n${content}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI DESIGN SPECIFIC TOOLS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

/**
 * Handle read_reference_image tool
 * 
 * Returns image data in a format suitable for multimodal LLM input.
 * The result will be added to conversation history as an image content block.
 */
async function handleReadReferenceImage(
  state: DesignGraphState,
  args: { path: string }
): Promise<{ type: 'image'; path: string; base64: string; mediaType: string } | string> {
  const { path: imagePath } = args;
  const fileSystem = state.deps?.fileSystem;
  const chatAPI = getChatAPIClient();
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const fs = await import('fs/promises');
  
  // ✅ Build absolute path for native fs operations
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  let absolutePath = imagePath;
  if (!path.isAbsolute(imagePath)) {
    absolutePath = path.join(featurePath, imagePath);
  }
  
  // ✅ Validate extension
  const ext = path.extname(absolutePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`);
  }
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  // ✅ Check file exists using relative path
  const exists = await fileSystem.fileExists(relativePath);
  if (!exists) {
    throw new Error(`Reference image not found: ${imagePath}`);
  }
  
  // ✅ Anthropic API limit: 5MB per image (base64)
  // Base64 encoding adds ~33% overhead, so raw file should be < 3.75MB
  // Using 3MB limit to be safe (Code job uses 2MB)
  const MAX_IMAGE_BYTES = parseInt(process.env.ANT_UI_IMAGE_MAX_BYTES || `${3 * 1024 * 1024}`, 10);
  
  // ✅ Check file size BEFORE reading
  const stats = await fs.stat(absolutePath);
  if (stats.size > MAX_IMAGE_BYTES) {
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const limitMB = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
    console.log(`   ⚠️  Image too large: ${imagePath} (${sizeMB}MB > ${limitMB}MB limit)`);
    console.log(`   💡 Consider resizing or compressing the image`);
    
    // Return text description instead of throwing
    return `⚠️ Image "${imagePath}" is too large (${sizeMB}MB). Anthropic API limit is 5MB per image (base64 encoded). ` +
           `Original file: ${sizeMB}MB → base64: ~${(stats.size * 1.33 / (1024 * 1024)).toFixed(2)}MB. ` +
           `Please resize or compress the image to under ${limitMB}MB and try again. ` +
           `Proceeding without this image - use available information from PRD/directive.`;
  }
  
  // ✅ UI notification: reading image
  const mergeIndex = await chatAPI.addReadingFile(imagePath);
  
  try {
    // ✅ Read image and convert to base64
    const imageBuffer = await fs.readFile(absolutePath);
    const base64 = imageBuffer.toString('base64');
    
    // ✅ Determine media type
    const mediaTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    const mediaType = mediaTypeMap[ext] || 'image/png';
    
    console.log(`   🖼️  Read image: ${imagePath} (${Math.round(stats.size / 1024)}KB, ${mediaType})`);
    
    // ✅ UI notification: read complete
    await chatAPI.addReadComplete(imagePath, mergeIndex);
    
    // Return structured image data for multimodal injection
    return {
      type: 'image',
      path: imagePath,
      base64,
      mediaType,
    };
  } catch (error) {
    await chatAPI.addReadComplete(imagePath, mergeIndex, (error as Error).message);
    throw error;
  }
}

/**
 * Handle list_reference_images tool
 * 
 * Lists all available reference images in inputs/references/
 */
async function handleListReferenceImages(
  state: DesignGraphState,
  args: { category?: string }
): Promise<string> {
  const { category } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build target directory path
  const referencesDir = path.join(featurePath, 'inputs', 'references');
  const targetDir = category 
    ? path.join(referencesDir, category)
    : referencesDir;
  
  // ✅ Convert to workspace-relative path (required by fileSystem port)
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, targetDir)
    : targetDir.replace(/^\//, '');
  
  // ✅ Use fileSystem port with relative path
  let allFiles: string[] = [];
  try {
    allFiles = await fileSystem.listFiles(relativePath, []);
  } catch {
    // Directory doesn't exist or not accessible
  }
  
  if (allFiles.length === 0) {
    return JSON.stringify({
      category: category || 'all',
      images: [],
      count: 0,
      message: 'No reference images found. Add images to inputs/references/',
    }, null, 2);
  }
  
  // ✅ Filter to image files only
  const imageFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  });
  
  // ✅ Convert workspace-relative paths to feature-relative paths for grouping
  const featureRelPath = rootPath
    ? path.relative(rootPath, featurePath)
    : featurePath.replace(/^\//, '');
  
  const referencesRelPath = rootPath
    ? path.relative(rootPath, referencesDir)
    : referencesDir.replace(/^\//, '');
  
  // ✅ Dynamic grouping by actual subdirectory names
  const grouped: Record<string, string[]> = {};
  
  for (const file of imageFiles) {
    // Convert workspace-relative to feature-relative path
    const featureRelativePath = file.startsWith(featureRelPath)
      ? file.slice(featureRelPath.length).replace(/^[\/\\]/, '')
      : file;
    
    // Determine group from path relative to references/
    const refRelative = file.startsWith(referencesRelPath)
      ? file.slice(referencesRelPath.length).replace(/^[\/\\]/, '')
      : featureRelativePath;
    const parts = refRelative.split(/[\/\\]/);
    const group = parts.length > 1 ? parts[0] : '(root)';
    (grouped[group] ||= []).push(featureRelativePath);
  }
  
  const groupSummary = Object.entries(grouped).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  console.log(`   🖼️  Found ${imageFiles.length} reference images (${groupSummary})`);
  if (imageFiles.length > 0) {
    console.log(`   📂 First few: ${imageFiles.slice(0, 3).map(f => path.basename(f)).join(', ')}`);
  }
  
  // ✅ UI notification — skip if 0 results
  if (imageFiles.length > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: imageFiles.length,
      filesList: imageFiles,
      _mergeIndex: mergeIndex
    });
  }
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: imageFiles.length,
  }, null, 2);
}

/**
 * Handle hallucinated append_file/write_file tool calls.
 *
 * LLM sometimes hallucinates these tools instead of using <file>/<append> XML tags.
 * Instead of returning an error and wasting a retry cycle, we intercept and execute
 * the file operation directly since the content is already available in args.
 */
async function handleHallucinatedFileWrite(
  state: DesignGraphState,
  filePath: string,
  content: string,
  isAppend: boolean,
): Promise<string> {
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }

  const chatAPI = getChatAPIClient();
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);

  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');

  await chatAPI.startFileEdit(filePath);

  try {
    if (isAppend) {
      const exists = await fileSystem.fileExists(relativePath);
      if (exists) {
        const existing = await fileSystem.readFile(relativePath);
        await fileSystem.writeFile(relativePath, existing + '\n' + content);
      } else {
        await fileSystem.writeFile(relativePath, content);
      }
    } else {
      await fileSystem.writeFile(relativePath, content);
    }

    // Notify file tree update
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);
      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate && filePath.startsWith('outputs/')) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [filePath]
        );
      }
    }

    // Chat UI notification
    await chatAPI.completeFileEdit(filePath, '', content);

    const action = isAppend ? 'appended' : 'written';
    return `File ${action} successfully: ${filePath} (auto-recovered from ${isAppend ? 'append_file' : 'write_file'} tool call)`;
  } catch (error) {
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIGMA MCP TOOL HANDLER (shared logic in tools/figmaMCPHandler.ts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildRootCallGuidance(state: DesignGraphState, toolName: string): string {
  const nodeSummary = state.figmaExplorationResult?.nodeSummary;
  const topFrames = nodeSummary
    ? nodeSummary
        .filter(n => n.depth <= 1 && (n.type === 'FRAME' || n.type === 'SECTION'))
        .map(n => `  - ${n.name} (nodeId: ${n.nodeId}, type: ${n.type}, children: ${n.childCount})`)
        .join('\n')
    : '  (nodeSummary not available)';

  return JSON.stringify({
    warning: 'Root node query returns too much data. Use specific nodeIds instead.',
    guidance: `Query individual frames/sections for detailed data. Available top-level nodes:\n${topFrames}`,
    tool: toolName,
    availableNodeCount: nodeSummary?.length ?? 0,
  });
}


/**
 * Handle download_asset tool
 *
 * Downloads a file from a URL and saves it to inputs/assets/{category}/{filename}.
 * Used by LLM to download Figma-exported assets (SVG, PNG, etc.) from CDN URLs
 * returned by get_design_context.
 */
async function handleDownloadAsset(
  state: DesignGraphState,
  args: { url: string; filename: string; category?: string }
): Promise<string> {
  const { url, filename } = args;
  let { category } = args;

  if (!url || !filename) {
    throw new Error('download_asset requires url and filename');
  }

  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }

  // Path traversal prevention
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized.includes('..') || sanitized.startsWith('/')) {
    throw new Error(`Invalid filename: ${filename}`);
  }

  // Infer category from extension if not provided
  if (!category) {
    const ext = sanitized.split('.').pop()?.toLowerCase();
    if (ext === 'svg') category = 'icons';
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) category = 'images';
    else category = 'misc';
  }

  const pathMod = await import('path');
  const fsMod = await import('fs/promises');

  const destDir = pathMod.join(featurePath, 'inputs', 'assets', category);
  await fsMod.mkdir(destDir, { recursive: true });

  const destPath = pathMod.join(destDir, sanitized);
  const relativePath = `inputs/assets/${category}/${sanitized}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fsMod.writeFile(destPath, buffer);

    const sizeKB = (buffer.length / 1024).toFixed(1);
    console.log(`📥 [Tool] download_asset: ${relativePath} (${sizeKB} KB)`);

    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);

      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [relativePath]
        );
      }
    }

    return JSON.stringify({
      success: true,
      path: relativePath,
      filename: sanitized,
      category,
      sizeBytes: buffer.length,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Download timed out after 30s: ${url}`);
    }
    throw new Error(`Failed to download asset from ${url}: ${err.message}`);
  }
}

/**
 * Handle list_assets tool
 *
 * Lists all runtime asset files in inputs/assets/
 */
async function handleListAssets(
  state: DesignGraphState,
  args: { category?: string }
): Promise<string> {
  const { category } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  const path = await import('path');
  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }
  
  // ✅ Build target directory path
  const assetsDir = path.join(featurePath, 'inputs', 'assets');
  const targetDir = category 
    ? path.join(assetsDir, category)
    : assetsDir;
  
  // ✅ Convert to workspace-relative path (required by fileSystem port)
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, targetDir)
    : targetDir.replace(/^\//, '');
  
  // ✅ Use fileSystem port with relative path
  let allFiles: string[] = [];
  try {
    allFiles = await fileSystem.listFiles(relativePath, []);
  } catch {
    // Directory doesn't exist or not accessible
  }
  
  if (allFiles.length === 0) {
    return JSON.stringify({
      category: category || 'all',
      assets: [],
      count: 0,
      message: 'No assets found. Add asset files to inputs/assets/',
    }, null, 2);
  }
  
  // ✅ Convert workspace-relative paths to feature-relative paths
  const featureRelPath = rootPath
    ? path.relative(rootPath, featurePath)
    : featurePath.replace(/^\//, '');
  
  const assetsRelPath = rootPath
    ? path.relative(rootPath, assetsDir)
    : assetsDir.replace(/^\//, '');
  
  // ✅ Dynamic grouping by actual subdirectory names
  const grouped: Record<string, { path: string; filename: string; extension: string }[]> = {};
  
  for (const file of allFiles) {
    // Convert workspace-relative to feature-relative path
    const featureRelativePath = file.startsWith(featureRelPath)
      ? file.slice(featureRelPath.length).replace(/^[\/\\]/, '')
      : file;
    const filename = path.basename(file);
    const extension = path.extname(file).toLowerCase();
    
    const assetInfo = { path: featureRelativePath, filename, extension };
    
    // Determine group from path relative to assets/
    const assetRelative = file.startsWith(assetsRelPath)
      ? file.slice(assetsRelPath.length).replace(/^[\/\\]/, '')
      : featureRelativePath;
    const parts = assetRelative.split(/[\/\\]/);
    const group = parts.length > 1 ? parts[0] : '(root)';
    (grouped[group] ||= []).push(assetInfo);
  }
  
  const totalCount = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
  const groupSummary = Object.entries(grouped).map(([k, v]) => `${k}: ${v.length}`).join(', ');
  console.log(`   📦 Found ${totalCount} assets (${groupSummary})`);
  
  // ✅ UI notification — skip if 0 results
  if (totalCount > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', { 
      filesCount: totalCount,
      filesList: allFiles,
      _mergeIndex: mergeIndex
    });
  }
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: totalCount,
  }, null, 2);
}
