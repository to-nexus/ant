/**
 * Handle delete_file tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { DeleteFileArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolPath } from './utils';

export async function handleDeleteFile(
  state: ArchitectGraphState,
  args: DeleteFileArgs
): Promise<string> {
  const { path: filePath } = args;
  
  const fileSystem = getFileSystem(state, 'deleteFile');
  const chatAPI = getChatAPIClient();
  
  return withErrorHandling('deleteFile', async () => {
    const resolved = await resolveToolPath(state, filePath);
    logFileOperation('deleteFile', 'Deleting file', resolved.displayPath, { fsPath: resolved.fsPath, scope: resolved.scope });
    
    // Check if file exists
    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (!exists) {
      throw new Error(`File does not exist: ${resolved.displayPath}`);
    }
    
    // Delete file
    await fileSystem.deleteFile(resolved.fsPath);
    console.log(`[deleteFile] ✅ Deleted: ${resolved.displayPath}`);
    
    // UI notification
    await chatAPI.completeFileDeletion(resolved.displayPath);
    
    // Broadcast file tree update (for "n Files Edited" counter)
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
        state.context.project,
        featureName
      );
    }
    
    return `File deleted successfully: ${resolved.displayPath}`;
  }, { filePath });
}

