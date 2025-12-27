/**
 * Handle read_file tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { ReadFileArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation } from './utils';

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
  
  // ✅ Add reading status and get index
  const mergeIndex = await chatAPI.addReadingFile(filePath);
  
  return withErrorHandling('readFile', async () => {
    logFileOperation('readFile', 'Reading file', filePath);
    
    // ✅ Check buffer first (uncommitted changes)
    const fileBuffers = state.fileBuffers || new Map();
    const buffered = fileBuffers.get(filePath);
    
    if (buffered && !buffered.committed) {
      console.log(`[readFile] ✅ Reading from buffer: ${filePath}`);
      await chatAPI.addReadComplete(filePath, mergeIndex);
      return buffered.content;
    }
    
    // ✅ Read from filesystem
    const content = await fileSystem.readFile(filePath);
    
    if (!content) {
      const errorMsg = `File not found: ${filePath}`;
      console.error(`[readFile] ❌ ${errorMsg}`);
      await chatAPI.addReadComplete(filePath, mergeIndex, errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log(`[readFile] ✅ Read from disk: ${filePath} (${content.length} bytes)`);
    
    // ✅ UI notification: read complete (success)
    await chatAPI.addReadComplete(filePath, mergeIndex);
    
    return content;
  }, { filePath });
}

