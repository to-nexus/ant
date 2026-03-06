/**
 * Handle read_file tool
 */

import * as path from 'path';
import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { ReadFileArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolPath } from './utils';

/**
 * Binary file extensions that should not be read as text.
 * Reading these files produces garbage text and wastes tokens.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.tif',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  // Media
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv',
  // Binary data
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  // Other
  '.sqlite', '.db', '.wasm',
]);

/**
 * Check if a file is binary based on its extension.
 */
function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export async function handleReadFile(
  state: ArchitectGraphState,
  args: ReadFileArgs
): Promise<string> {
  const { path: filePath, startLine, endLine } = args;
  
  if (!filePath) {
    throw new Error('read_file requires path');
  }
  
  if (isBinaryFile(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    console.log(`[readFile] ⚠️ Binary file detected: ${filePath} (${ext})`);
    return `[Binary file: ${filePath}]
This is a binary file (${ext}) and cannot be read as text.

To check if file exists: use list_files("${path.dirname(filePath)}")
To use in code: reference the path directly (e.g., url('${filePath}') or <img src="${filePath}" />)
To copy: use run_command("cp source dest")

Proceed with your next action.`;
  }
  
  const fileSystem = getFileSystem(state, 'readFile');
  const chatAPI = getChatAPIClient();

  const resolved = await resolveToolPath(state, filePath);
  
  const mergeIndex = await chatAPI.addReadingFile(resolved.displayPath);
  
  return withErrorHandling('readFile', async () => {
    logFileOperation('readFile', 'Reading file', resolved.displayPath, { fsPath: resolved.fsPath, scope: resolved.scope });
    
    const content = await fileSystem.readFile(resolved.fsPath);
    
    if (!content) {
      const errorMsg = `File not found: ${resolved.displayPath}`;
      console.error(`[readFile] ❌ ${errorMsg}`);
      await chatAPI.addReadComplete(resolved.displayPath, mergeIndex, errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log(`[readFile] ✅ Read from disk: ${resolved.displayPath} (${content.length} bytes)`);
    
    await chatAPI.addReadComplete(resolved.displayPath, mergeIndex);

    if (startLine || endLine) {
      const lines = content.split('\n');
      const totalLines = lines.length;
      const start = Math.max(1, startLine || 1);
      const end = Math.min(totalLines, endLine || totalLines);
      const slice = lines.slice(start - 1, end).join('\n');
      return `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`;
    }
    
    return content;
  }, { filePath: resolved.displayPath });
}

