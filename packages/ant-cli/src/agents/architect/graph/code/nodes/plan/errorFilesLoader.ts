/**
 * Error Files Loader
 * 
 * Loads files from error violations directly from local filesystem:
 * 1. Resolve exact file path using file resolver
 * 2. Load latest content from local Git (includes uncommitted changes)
 * 
 * Note: No Vector DB search - error files have exact paths!
 */

import path from "path";
import { GitPort, FileSystemPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";

export interface LoadedFile {
  path: string;
  content: string;
  source: 'vector_db' | 'local';  // Shared with semanticSearch - always 'local' for error files
}

/**
 * Load error files from local filesystem
 * 
 * @param errorFilePaths - Array of file paths from error violations
 * @param state - Current graph state
 * @param git - Git port for file operations
 * @param fileSystem - FileSystem port for file operations
 * @returns Array of loaded files with content
 */
export async function loadErrorFiles(
  errorFilePaths: string[],
  state: ArchitectGraphState,
  git: GitPort,
  fileSystem: FileSystemPort
): Promise<LoadedFile[]> {
  const loadedFiles: LoadedFile[] = [];
  const chatAPI = getChatAPIClient();
  
  if (errorFilePaths.length === 0) return loadedFiles;
  
  // Apply limit to error files (priority files with strict quota)
  const fileLimit = Math.min(errorFilePaths.length, RETRIEVAL_CONFIG.MAX_STACK_TRACE);
  console.log(`   📍 Error files: ${errorFilePaths.length} files → loading ${fileLimit} files (max ${RETRIEVAL_CONFIG.MAX_STACK_TRACE})...`);
  console.log(`   📊 Error files loaded: ${fileLimit} (semantic quota will adjust accordingly)`);
  
  const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
  
  // Load error files directly from local
  for (const filePath of errorFilePaths.slice(0, fileLimit)) {
    try {
      console.log(`      🔍 Local file: ${filePath}`);
      const resolved = await resolveStackTraceFile(filePath, state.context.workingDir, git, fileSystem);
      
      if (resolved.confidence === 'not_found') {
        console.error(`      ❌ FAILED to resolve: ${filePath}`);
        continue;
      }
      
      const resolvedPath = resolved.resolvedPath;
      console.log(`      ✅ Resolved (${resolved.confidence}): ${resolvedPath}`);
      
      if (resolved.candidates && resolved.candidates.length > 1) {
        console.log(`         📋 Other candidates: ${resolved.candidates.filter(c => c !== resolvedPath).slice(0, 3).join(', ')}`);
      }
      
      // Load file content
      // FileSystemPort expects paths relative to workspace root, not absolute paths.
      const fullPath = path.join(state.context.workingDir, resolvedPath);
      const rootPath = fileSystem.getRootPath();
      const relativePath = path.relative(rootPath, fullPath);
      const content = await fileSystem.readFile(relativePath);
      
      if (content) {
        loadedFiles.push({ path: resolvedPath, content, source: 'local' });
        console.log(`      📄 Loaded from local: ${resolvedPath}`);
      } else {
        console.warn(`      ⚠️  File empty or unreadable: ${resolvedPath}`);
      }
    } catch (e: any) {
      console.error(`      ❌ Failed to load ${filePath}: ${e.message}`);
    }
  }
  
  // Display in UI (Grepped - all error files are local)
  if (loadedFiles.length > 0) {
    console.log(`\n📤 [errorFilesLoader] Sending 'grepped' status (${loadedFiles.length} files)...`);
    try {
      await chatAPI.showChatStatus('grepped', {
        filesCount: loadedFiles.length,
        keywords: errorFilePaths.slice(0, fileLimit),
        filesList: loadedFiles.map(f => f.path),
        content: `Grepped: ${loadedFiles.length} error files from local`
      });
      console.log(`   ✅ 'grepped' status sent successfully\n`);
    } catch (error: any) {
      console.error(`   ❌ 'grepped' status FAILED:`, error.message);
    }
  } else {
    console.log(`   ℹ️  Grepped: 0 error files (skipping UI)`);
  }
  
  console.log(`   Error files loader: ${loadedFiles.length} files loaded\n`);
  return loadedFiles;
}
