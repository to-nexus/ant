/**
 * Handle list_files tool
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { ListFilesArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolDirectory } from './utils';

export async function handleListFiles(
  state: ArchitectGraphState,
  args: ListFilesArgs
): Promise<string[]> {
  const { directory = '.', pattern } = args;
  
  const fileSystem = getFileSystem(state, 'listFiles');
  const chatAPI = getChatAPIClient();

  const resolvedDir = await resolveToolDirectory(state, directory);
  
  // UI: Show listing_files status
  const listingIndex = await chatAPI.showChatStatus('listing_files', { 
    directory: resolvedDir.displayPath || '.', 
    pattern 
  });
  
  return withErrorHandling('listFiles', async () => {
    logFileOperation('listFiles', 'Listing directory', resolvedDir.displayPath, { pattern, fsPath: resolvedDir.fsPath, scope: resolvedDir.scope });
    
    const items = await fileSystem.readDirectory(resolvedDir.fsPath);
    
    // Add type suffix for directories so UI can distinguish them
    const itemsWithType = items.map(item => 
      item.isDirectory ? `${item.name}/` : item.name
    );
    
    // Filter by pattern if provided
    const filtered = pattern 
      ? itemsWithType.filter(f => f.includes(pattern))
      : itemsWithType;
    
    console.log(`[listFiles] Listed ${filtered.length} items in ${directory}`);
    
    // UI notification: listed_files complete
    await chatAPI.showChatStatus('listed_files', { 
      filesCount: filtered.length,
      totalFiles: items.length,
      pattern,
      filesList: filtered.slice(0, 20),
      _mergeIndex: listingIndex
    });
    
    return filtered;
  }, { directory: resolvedDir.displayPath, pattern });
}

