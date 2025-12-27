/**
 * Handle edit_file tool
 * Applies search/replace operation to existing file
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { EditFileArgs } from '../types';

export async function handleEditFile(
  state: ArchitectGraphState,
  args: EditFileArgs
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
  
  // ✅ NOTE: Loading card (file_editing) is already created by tool_use event handler
  // No need to call startFileEdit here - it would be redundant
  
  try {
    // ✅ Check if file exists
    const exists = await fileSystem.fileExists(filePath);
    if (!exists) {
      throw new Error(`File does not exist: ${filePath}. Use <file> tag to create new files.`);
    }
    
    // ✅ Read current file content (always from disk to ensure latest state)
    const originalContent = await fileSystem.readFile(filePath);
    if (!originalContent) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
    
    // ✅ Apply search/replace using existing logic
    const { applySearchReplace } = await import('../../../../../../../core/streaming/strategies/common/EditOperations');
    const modifiedContent = applySearchReplace(
      originalContent,
      old_str,
      new_str,
      filePath
    );
    
    // ✅ Write modified content back to disk
    await fileSystem.writeFile(filePath, modifiedContent);
    
    console.log(`✅ [EditFile] Successfully edited ${filePath}`);
    console.log(`   Replaced ${old_str.length} chars with ${new_str.length} chars`);
    
    // ✅ UI notification: file edit complete
    await chatAPI.completeFileEdit(filePath, old_str, new_str);
    
    // ✅ Update file buffer (for subsequent read_file calls)
    const fileBuffers = state.fileBuffers || new Map();
    fileBuffers.set(filePath, {
      filePath,
      content: modifiedContent,
      committed: false,
      lastModified: Date.now()
    });
    
    // ✅ Broadcast file tree update
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
        state.context.project,
        featureName
      );
    }
    
    return `File edited successfully: ${filePath}\nReplaced ${old_str.length} characters with ${new_str.length} characters.`;
  } catch (error) {
    // ✅ UI notification: file edit failed
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}

