/**
 * Tool Node (Design Job) - 도구 실행 (배치 지원)
 * 
 * NOTE: Code job의 tool 노드와 거의 동일하지만 DesignGraphState 사용
 */

import { DesignGraphState } from '../state';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { TokenBudgetManager } from '../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../core/utils/toolResultManager';

const tokenManager = new TokenBudgetManager();
const toolResultManager = new ToolResultManager(tokenManager);

/**
 * Execute a single design tool and return its result content (Anthropic format)
 */
async function executeDesignTool(
  name: string,
  state: DesignGraphState,
  args: Record<string, any>
): Promise<{ result: any; error?: string; toolResultContent: any }> {
  let result: any;
  let error: string | undefined;

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
      case 'read_reference_image':
        result = await handleReadReferenceImage(state, args as any);
        break;
      case 'list_reference_images':
        result = await handleListReferenceImages(state, args as any);
        break;
      case 'list_assets':
        result = await handleListAssets(state, args as any);
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
  }

  // Build tool result content (handles image multimodal)
  let toolResultContent: any;

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
  } else {
    const truncation = toolResultManager.truncateResult(name, result, error);
    toolResultContent = truncation.content;
    if (truncation.wasTruncated) {
      console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
    }
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
  const newHistory = [
    ...(state.conversationHistory || []),
    { role: 'assistant' as const, content: toolUseBlocks },
    { role: 'user' as const, content: toolResultBlocks },
  ];

  // Workflow: exit once per batch
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'tool', (state as any).workerId ?? 0);
  }

  return {
    conversationHistory: newHistory,
    files: state.files,
    llmResponse: {
      ...state.llmResponse!,
      toolCalls: [],
    },
  };
}

/**
 * Handle read_file tool
 */
async function handleReadFile(
  state: DesignGraphState,
  args: { path: string }
): Promise<string> {
  const { path: filePath } = args;
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
  
  // ✅ Build absolute path for logging
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
  // ✅ Convert to workspace-relative path for fileSystem port
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  // ✅ Add reading status and get index
  const mergeIndex = await chatAPI.addReadingFile(filePath);
  
  try {
    const content = await fileSystem.readFile(relativePath);
    if (!content) {
      throw new Error(`File not found or empty: ${filePath}`);
    }
    
    console.log(`   📖 Read: ${relativePath} (${content.length} bytes)`);
    
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
  
  // ✅ UI notification: grepping complete (local file list)
  const chatAPI = getChatAPIClient();
  const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
  await chatAPI.showChatStatus('grepped', { 
    filesCount: filteredFiles.length,
    filesList: filteredFiles,
    _mergeIndex: mergeIndex
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
  
  // ✅ UI notification: search complete
  const chatAPI = getChatAPIClient();
  const matchedFiles = [...new Set(results.map(r => r.file))];
  const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
  await chatAPI.showChatStatus('grepped', { 
    filesCount: matchedFiles.length,
    filesList: matchedFiles,
    _mergeIndex: mergeIndex
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
  
  // ✅ UI notification
  const chatAPI = getChatAPIClient();
  const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
  await chatAPI.showChatStatus('grepped', { 
    filesCount: imageFiles.length,
    filesList: imageFiles,
    _mergeIndex: mergeIndex
  });
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: imageFiles.length,
  }, null, 2);
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
  
  // ✅ UI notification
  const chatAPI = getChatAPIClient();
  const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
  await chatAPI.showChatStatus('grepped', { 
    filesCount: totalCount,
    filesList: allFiles,
    _mergeIndex: mergeIndex
  });
  
  return JSON.stringify({
    category: category || 'all',
    groups: grouped,
    total: totalCount,
  }, null, 2);
}
