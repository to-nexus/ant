/**
 * Handle edit_file tool
 * Applies search/replace operation to existing file
 *
 * Supports automatic I/O-level retry for stale content conflicts
 * in parallel mode (WorkerFileSystem + SharedFileBuffer).
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { EditFileArgs } from '../types';
import { resolveToolPath } from './utils';

const MAX_IO_RETRIES = 3;

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
  
  try {
    const resolved = await resolveToolPath(state, filePath);

    // ✅ Check if file exists
    const exists = await fileSystem.fileExists(resolved.fsPath);
    if (!exists) {
      throw new Error(`File does not exist: ${resolved.displayPath}. Use <file> tag to create new files.`);
    }
    
    // ✅ I/O level auto-retry loop for stale content conflicts
    // When another worker modifies the file between our read and write,
    // SharedFileBuffer detects the version mismatch (stale). We re-read
    // the latest content and re-apply the search/replace up to MAX_IO_RETRIES times.
    const { applySearchReplace } = await import('../../../../../../../core/streaming/strategies/common/EditOperations');
    const { FileConflictError } = await import('../../../parallel/WorkerFileSystem');
    
    let modifiedContent: string = '';
    
    for (let attempt = 0; attempt < MAX_IO_RETRIES; attempt++) {
      // Read current file content (WorkerFileSystem tracks version via readVersions)
      const originalContent = await fileSystem.readFile(resolved.fsPath);
      if (!originalContent) {
        throw new Error(`Failed to read file: ${resolved.displayPath}`);
      }
      
      // Apply search/replace
      modifiedContent = applySearchReplace(
        originalContent,
        old_str,
        new_str,
        resolved.displayPath
      );
      
      try {
        // Write modified content (SharedFileBuffer checks version)
        await fileSystem.writeFile(resolved.fsPath, modifiedContent);
        break; // Success
      } catch (e) {
        if (e instanceof FileConflictError && e.stale && attempt < MAX_IO_RETRIES - 1) {
          console.log(`⚠️ [EditFile] Stale content detected for ${resolved.displayPath}, retrying (attempt ${attempt + 1}/${MAX_IO_RETRIES})`);
          await chatAPI.showChatStatus('file_conflict_retry' as any, {
            filePath: resolved.displayPath,
            attempt: attempt + 1,
            maxRetries: MAX_IO_RETRIES,
          });
          continue; // Re-read, re-apply, re-write
        }
        throw e; // Non-stale error or max retries exceeded
      }
    }
    
    console.log(`✅ [EditFile] Successfully edited ${resolved.displayPath}`);
    console.log(`   Replaced ${old_str.length} chars with ${new_str.length} chars`);
    
    // ✅ UI notification: file edit complete
    await chatAPI.completeFileEdit(resolved.displayPath, old_str, new_str);
    
    // ✅ Broadcast file tree update
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
        state.context.project,
        featureName
      );
    }
    
    return `File edited successfully: ${resolved.displayPath}\nReplaced ${old_str.length} characters with ${new_str.length} characters.`;
  } catch (error) {
    // ✅ UI notification: file edit failed
    await chatAPI.failFileEdit(filePath, (error as Error).message);
    throw error;
  }
}

