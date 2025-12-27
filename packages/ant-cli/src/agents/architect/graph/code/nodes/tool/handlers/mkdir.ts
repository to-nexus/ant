/**
 * Handle mkdir tool
 */

import { ArchitectGraphState } from '../../../state';
import { MkdirArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation } from './utils';

export async function handleMkdir(
  state: ArchitectGraphState,
  args: MkdirArgs
): Promise<string> {
  const { path: dirPath } = args;
  
  const fileSystem = getFileSystem(state, 'mkdir');
  
  return withErrorHandling('mkdir', async () => {
    logFileOperation('mkdir', 'Creating directory', dirPath);
    
    await fileSystem.createDirectory(dirPath);
    
    console.log(`[mkdir] ✅ Created directory: ${dirPath}`);
    
    return `Directory created: ${dirPath}`;
  }, { dirPath });
}

