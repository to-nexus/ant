/**
 * Handle mkdir tool
 */

import { ArchitectGraphState } from '../../../state';
import { MkdirArgs } from '../types';
import { getFileSystem, withErrorHandling, logFileOperation, resolveToolPath, prependFixMessage } from './utils';

export async function handleMkdir(
  state: ArchitectGraphState,
  args: MkdirArgs
): Promise<string> {
  const { path: dirPath } = args;
  
  const fileSystem = getFileSystem(state, 'mkdir');
  
  return withErrorHandling('mkdir', async () => {
    const resolved = await resolveToolPath(state, dirPath);
    logFileOperation('mkdir', 'Creating directory', resolved.fsPath);
    
    await fileSystem.createDirectory(resolved.fsPath);
    
    console.log(`[mkdir] ✅ Created directory: ${resolved.displayPath}`);
    
    return prependFixMessage(resolved, `Directory created: ${resolved.displayPath}`);
  }, { dirPath });
}

