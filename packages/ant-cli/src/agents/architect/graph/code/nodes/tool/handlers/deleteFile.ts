/**
 * Handle delete_file tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { DeleteFileArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation } from './utils';

export async function handleDeleteFile(
  state: ArchitectGraphState,
  args: DeleteFileArgs
): Promise<string> {
  const { path: filePath } = args;
  
  const fileSystem = getFileSystem(state, 'deleteFile');
  const chatAPI = getChatAPIClient();
  
  return withErrorHandling('deleteFile', async () => {
    logFileOperation('deleteFile', 'Deleting file', filePath);
    
    // Check if file exists
    const exists = await fileSystem.fileExists(filePath);
    if (!exists) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    
    // Delete file
    await fileSystem.deleteFile(filePath);
    console.log(`[deleteFile] ✅ Deleted: ${filePath}`);
    
    // UI notification
    await chatAPI.completeFileDeletion(filePath);
    
    // Broadcast file tree update (for "n Files Edited" counter)
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
        state.context.project,
        featureName
      );
    }
    
    return `File deleted successfully: ${filePath}`;
  }, { filePath });
}

