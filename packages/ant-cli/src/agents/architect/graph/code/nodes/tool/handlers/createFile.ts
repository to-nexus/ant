/**
 * Handle file creation via shadow tool
 * 
 * This is a SHADOW TOOL - not exposed in available tools list.
 * When LLM incorrectly calls 'file', 'write_file', or 'create_file' tool
 * instead of using <file> XML tag, this handler gracefully creates the file
 * instead of returning "Unknown tool" error.
 * 
 * The tool result includes a correction note to guide LLM toward using
 * the proper <file> XML tag format for future file creation.
 */

import { ArchitectGraphState } from '../../../state';
import { getChatAPIClient } from '../../../../../../../core/adapters/ChatAPIClient';
import { CreateFileArgs } from '../types';
import { resolveToolPath, prependFixMessage } from './utils';

export async function handleCreateFile(
  state: ArchitectGraphState,
  args: CreateFileArgs
): Promise<string> {
  const { path: filePath, content } = args;
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    throw new Error('FileSystemPort not available');
  }
  
  if (!filePath) {
    throw new Error('create_file requires path');
  }
  
  if (content === undefined || content === null) {
    throw new Error('create_file requires content');
  }
  
  const chatAPI = getChatAPIClient();
  
  try {
    const resolved = await resolveToolPath(state, filePath);
    
    // ✅ Use writeNewFile for cross-worker conflict detection (parallel mode)
    const workerFS = fileSystem as any;
    if (typeof workerFS.writeNewFile === 'function') {
      const result = await workerFS.writeNewFile(resolved.fsPath, content);
      if (!result.success) {
        console.log(`⚠️ [CreateFile] Conflict: ${result.error}`);
        throw new Error(result.error || `File "${resolved.displayPath}" was already created by another task. Use read_file + edit_file to merge your changes.`);
      }
    } else {
      // Non-parallel mode: direct write
      await fileSystem.writeFile(resolved.fsPath, content);
    }
    
    console.log(`✅ [CreateFile] Created ${resolved.displayPath} (${content.length} chars)`);
    console.log(`   ⚠️  Shadow tool used - LLM should use <file> XML tag instead`);
    
    // UI notification: complete file creation (FileCard transition: file_creating → file_create)
    await chatAPI.completeFileCreation(resolved.displayPath, content);
    
    // Broadcast file tree update
    if (state.deps?.fileTreeUpdate) {
      const featureName = state.context.featureFolder || 'default';
      await state.deps.fileTreeUpdate.notifyFileTreeUpdate(
        state.context.project,
        featureName
      );
    }
    
    const resultMsg = [
      `File created successfully: ${resolved.displayPath} (${content.length} chars)`,
      ``,
      `⚠️ IMPORTANT: Do NOT use tool calls for file creation.`,
      `Use the <file> XML tag instead, which enables real-time streaming:`,
      `<file path="${resolved.displayPath}">`,
      `...content...`,
      `</file>`,
    ].join('\n');
    return prependFixMessage(resolved, resultMsg);
  } catch (error) {
    // UI notification: file creation failed
    await chatAPI.failFileCreation(filePath, (error as Error).message);
    throw error;
  }
}
