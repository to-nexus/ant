import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { DesignGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';

/** See `agents/common/tool/handlers/searchCode.ts` for the ripgrep contract
 *  rationale. The design-job adapter uses the same binary so the shared
 *  `search_code` tool schema (regex-based) holds across jobs. */
async function runRipgrep(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(rgPath, args, { cwd });
    } catch (err) {
      resolve({ stdout: '', stderr: (err as Error).message, code: 2 });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 2 }));
  });
}

/**
 * Handle read_file tool with optional line range support.
 * Without startLine/endLine: returns full content (may be truncated by ToolResultManager).
 * With startLine/endLine: returns the specified line range with a header.
 */
export async function handleReadFile(
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
export async function handleListFiles(
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
  
  const absoluteDir = path.isAbsolute(directory || '.')
    ? (directory || '.')
    : path.join(featurePath, directory || '.');
  
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
  
  const filteredFiles = pattern 
    ? files.filter(f => f.includes(pattern))
    : files;
  
  console.log(`   📂 Listed: ${filteredFiles.length} files in ${directory || '.'}`);
  
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
 * Handle search_code tool (ripgrep-backed).
 *
 * Contract matches the shared `search_code` tool schema: `pattern` is a
 * ripgrep regex, `file_pattern` is a ripgrep glob. The output JSON keeps
 * the legacy `{ pattern, file_pattern, results, count }` shape so design
 * tool adapters / prompts that consume the result stay source-compatible.
 */
export async function handleSearchCode(
  state: DesignGraphState,
  args: { pattern: string; file_pattern?: string }
): Promise<string> {
  const { pattern, file_pattern } = args;
  const fileSystem = state.deps?.fileSystem;

  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }

  const featurePath = state.context.featurePath;
  if (!featurePath) {
    throw new Error('featurePath not available in context');
  }

  const rgArgs: string[] = [
    '--no-heading',
    '--line-number',
    '--color', 'never',
    '--max-count', '200',
    '--max-filesize', '1M',
    '--glob', '!node_modules',
    '--glob', '!.git',
  ];
  if (file_pattern) {
    rgArgs.push('--glob', file_pattern);
  }
  rgArgs.push('--', pattern, featurePath);

  const { stdout, stderr, code } = await runRipgrep(rgArgs, featurePath);

  if (code === 2) {
    console.error(`   🔍 ripgrep error: ${stderr.trim()}`);
    return JSON.stringify({
      pattern,
      file_pattern,
      results: [],
      count: 0,
      error: stderr.trim() || 'ripgrep exited with error (invalid regex?)',
    }, null, 2);
  }

  const rootPrefix = featurePath.endsWith('/') ? featurePath : featurePath + '/';
  const lines = stdout.split('\n').filter(l => l.length > 0);

  const results = lines.slice(0, 500).map(raw => {
    const line = raw.startsWith(rootPrefix) ? raw.slice(rootPrefix.length) : raw;
    const m = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!m) return null;
    return { file: m[1], line: parseInt(m[2], 10), snippet: m[3].trim() };
  }).filter(Boolean);

  console.log(`   🔍 Search: "${pattern}" found ${results.length} results`);

  const matchedFiles = [...new Set(results.map(r => r!.file))];
  if (matchedFiles.length > 0) {
    const chatAPI = getChatAPIClient();
    const mergeIndex = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', {
      filesCount: matchedFiles.length,
      filesList: matchedFiles,
      _mergeIndex: mergeIndex,
    });
  }

  return JSON.stringify({
    pattern,
    file_pattern,
    results,
    count: results.length,
  }, null, 2);
}

/**
 * Handle delete_file tool
 */
export async function handleDeleteFile(
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
  
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
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
  
  state.files = (state.files || []).filter(f => f.path !== filePath);
  
  return `File deleted successfully: ${filePath}`;
}

/**
 * Handle edit_file tool (Design job)
 */
export async function handleEditFile(
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
  
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(featurePath, filePath);
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  await chatAPI.startFileEdit(filePath);
  
  try {
    const exists = await fileSystem.fileExists(relativePath);
    if (!exists) {
      throw new Error(`File does not exist: ${filePath}. Use <file> tag to create new files.`);
    }
    
    const originalContent = await fileSystem.readFile(relativePath);
    if (!originalContent) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
    
    const { applySearchReplace } = await import('../../../../../../../core/streaming/strategies/common/EditOperations');
    const modifiedContent = applySearchReplace(
      originalContent,
      old_str,
      new_str,
      filePath
    );
    
    await fileSystem.writeFile(relativePath, modifiedContent);
    
    console.log(`✅ [EditFile] Successfully edited ${relativePath}`);
    console.log(`   Replaced ${old_str.length} chars with ${new_str.length} chars`);
    
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);
      
      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate && filePath.startsWith('outputs/')) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [filePath]
        );
      }
    }
    
    await chatAPI.completeFileEdit(filePath, old_str, new_str);
    
    return `File edited successfully: ${filePath}\nReplaced ${old_str.length} characters with ${new_str.length} characters.`;
  } catch (error) {
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}

/**
 * Handle mkdir tool
 */
export async function handleMkdir(
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
  
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(featurePath, dirPath);
  
  const rootPath = fileSystem.getRootPath?.() || '';
  const relativePath = rootPath
    ? path.relative(rootPath, absolutePath)
    : absolutePath.replace(/^\//, '');
  
  await fileSystem.createDirectory(relativePath);
  console.log(`   📁 Created directory: ${relativePath}`);
  
  return `Directory created: ${dirPath}`;
}

/**
 * Handle hallucinated append_file/write_file tool calls.
 *
 * LLM sometimes hallucinates these tools instead of using <file>/<append> XML tags.
 * Instead of returning an error and wasting a retry cycle, we intercept and execute
 * the file operation directly since the content is already available in args.
 */
export async function handleHallucinatedFileWrite(
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

    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      state.deps.fileTreeUpdate.notifyFileTreeUpdate(state.context.project, featureName);
      if ('addUnseenArtifacts' in state.deps.fileTreeUpdate && filePath.startsWith('outputs/')) {
        (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
          state.context.project, featureName, [filePath]
        );
      }
    }

    await chatAPI.completeFileEdit(filePath, '', content);

    const action = isAppend ? 'appended' : 'written';
    return `File ${action} successfully: ${filePath} (auto-recovered from ${isAppend ? 'append_file' : 'write_file'} tool call)`;
  } catch (error) {
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}
