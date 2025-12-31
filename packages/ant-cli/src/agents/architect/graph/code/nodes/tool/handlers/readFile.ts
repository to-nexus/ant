/**
 * Handle read_file tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { ReadFileArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolPath } from './utils';

export async function handleReadFile(
  state: ArchitectGraphState,
  args: ReadFileArgs
): Promise<string> {
  const { path: filePath } = args;
  
  if (!filePath) {
    throw new Error('read_file requires path');
  }
  
  const fileSystem = getFileSystem(state, 'readFile');
  const chatAPI = getChatAPIClient();

  // Canonicalize paths so tool usage is stable (repo-relative by default)
  const resolved = await resolveToolPath(state, filePath);
  
  // ✅ Add reading status and get index
  const mergeIndex = await chatAPI.addReadingFile(resolved.displayPath);
  
  return withErrorHandling('readFile', async () => {
    logFileOperation('readFile', 'Reading file', resolved.displayPath, { fsPath: resolved.fsPath, scope: resolved.scope });
    
    // ✅ Check buffer first (uncommitted changes)
    const fileBuffers = state.fileBuffers || new Map();
    const buffered = fileBuffers.get(resolved.displayPath) || fileBuffers.get(filePath) || fileBuffers.get(resolved.fsPath);
    
    if (buffered && !buffered.committed) {
      console.log(`[readFile] ✅ Reading from buffer: ${resolved.displayPath}`);
      await chatAPI.addReadComplete(resolved.displayPath, mergeIndex);
      return buffered.content;
    }
    
    // ✅ Read from filesystem
    const content = await fileSystem.readFile(resolved.fsPath);
    
    if (!content) {
      const errorMsg = `File not found: ${resolved.displayPath}`;
      console.error(`[readFile] ❌ ${errorMsg}`);
      await chatAPI.addReadComplete(resolved.displayPath, mergeIndex, errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log(`[readFile] ✅ Read from disk: ${resolved.displayPath} (${content.length} bytes)`);
    
    // ✅ UI notification: read complete (success)
    await chatAPI.addReadComplete(resolved.displayPath, mergeIndex);
    
    return content;
  }, { filePath: resolved.displayPath });
}

