/**
 * Stack Trace File Loader
 * 
 * Loads files mentioned in error stack traces:
 * 1. Vector DB search (find paths)
 * 2. Load from local Git (latest content + uncommitted changes)
 * 3. Fallback to File Resolver if Vector DB fails
 */

import { GitPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";

export interface LoadedFile {
  path: string;
  content: string;
  source: 'vector_db' | 'file_resolver';
}

export async function loadStackTraceFiles(
  stackTracePaths: string[],
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort,
  extractFilesFromCode: (code: string) => Array<{path: string; content: string}>
): Promise<LoadedFile[]> {
  const stackFiles: LoadedFile[] = [];
  const chatAPI = getChatAPIClient();
  
  if (stackTracePaths.length === 0) return stackFiles;
  
  // ✅ CRITICAL: Stack trace is PRIORITY, so we enforce strict limit
  const stackLimit = Math.min(stackTracePaths.length, RETRIEVAL_CONFIG.MAX_STACK_TRACE);
  console.log(`   📍 Stack trace: ${stackTracePaths.length} files → loading ${stackLimit} files (max ${RETRIEVAL_CONFIG.MAX_STACK_TRACE})...`);
  console.log(`   📊 Remaining quota for semantic: ${RETRIEVAL_CONFIG.TOTAL_MAX - stackLimit} files`);
  
  await chatAPI.showChatStatus('retrieving', {
    query: `Stack trace: ${stackTracePaths.join(', ')}`
  });
  
  const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
  
  // Step 1: Try Vector DB for all files
  for (const filePath of stackTracePaths.slice(0, stackLimit)) {
    let resolvedPath: string | null = null;
    let source: 'vector_db' | 'file_resolver' | null = null;
    
    // Try Vector DB first
    try {
      console.log(`      🔍 Vector DB: ${filePath}`);
      const vectorResult = await retriever.retrieve(
        filePath,
        state.context.workingDir,
        { vectorDB, git },
        { project: state.context.project, maxTokens: 5000, maxFiles: 1, mode: 'refactor' }
      );
      
      const files = extractFilesFromCode(vectorResult.code);
      if (files.length > 0) {
        resolvedPath = files[0].path;
        source = 'vector_db';
        console.log(`      ✅ Vector DB retrieved: ${resolvedPath}`);
      }
    } catch (e: any) {
      console.warn(`      ⚠️  Vector DB failed: ${e.message}`);
    }
    
    // If Vector DB failed, mark for local search (grepped)
    if (!resolvedPath) {
      try {
        console.log(`      🔍 Local file search: ${filePath}`);
        const resolved = await resolveStackTraceFile(filePath, state.context.workingDir, git);
        
        if (resolved.confidence !== 'not_found') {
          resolvedPath = resolved.resolvedPath;
          source = 'file_resolver';  // This will be shown in "grepped"
          console.log(`      ✅ Local search (${resolved.confidence}): ${resolvedPath}`);
          if (resolved.candidates && resolved.candidates.length > 1) {
            console.log(`         📋 Other candidates: ${resolved.candidates.filter(c => c !== resolvedPath).slice(0, 3).join(', ')}`);
          }
        }
      } catch (e: any) {
        console.warn(`      ⚠️  Local search failed: ${e.message}`);
      }
    }
    
    // Load content from local Git
    if (resolvedPath && source) {
      try {
        const fullPath = require('path').join(state.context.workingDir, resolvedPath);
        const content = await git.readFile(fullPath);
        
        if (content) {
          stackFiles.push({ path: resolvedPath, content, source });
          console.log(`      📄 Loaded from local: ${resolvedPath}`);
        } else {
          console.warn(`      ⚠️  File empty or unreadable: ${resolvedPath}`);
        }
      } catch (e: any) {
        console.error(`      ❌ Failed to load from local: ${resolvedPath} - ${e.message}`);
      }
    } else {
      console.error(`      ❌ FAILED to resolve: ${filePath}`);
    }
  }
  
  // Separate files by source
  const vectorDbFiles = stackFiles.filter(f => f.source === 'vector_db');
  const greppedFiles = stackFiles.filter(f => f.source === 'file_resolver');
  
  // Check for git changes (only for Vector DB files)
  let exploredFiles: string[] = [];
  if (vectorDbFiles.length > 0) {
    try {
      const changedFiles = await git.getChangedFiles();
      const changedFileSet = new Set(changedFiles);
      exploredFiles = vectorDbFiles.filter(f => changedFileSet.has(f.path)).map(f => f.path);
    } catch (e: any) {
      console.warn(`      ⚠️  Git changes check failed: ${e.message}`);
    }
  }
  
  // Display: 1. Retrieved (Vector DB only) - 항상 표시
  console.log(`\n📤 [stackTraceLoader] Sending 'retrieved' status (${vectorDbFiles.length} files)...`);
  try {
    await chatAPI.showChatStatus('retrieved', {
      filesCount: vectorDbFiles.length,
      filesList: vectorDbFiles.map(f => f.path),
      content: `Retrieved: ${vectorDbFiles.length} files related to stacktrace from Vector DB`
    });
    console.log(`   ✅ 'retrieved' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'retrieved' status FAILED:`, error.message);
  }
  
  // Display: 2. Explored (Git changes in retrieved files) - 항상 표시
  console.log(`\n📤 [stackTraceLoader] Sending 'explored' status (${exploredFiles.length} files)...`);
  try {
    await chatAPI.showChatStatus('explored', {
      filesCount: exploredFiles.length,
      filesList: exploredFiles,
      content: exploredFiles.length > 0
        ? `Explored: ${exploredFiles.length} files with uncommitted changes related to stacktrace`
        : `Explored: No uncommitted changes related to stacktrace`
    });
    console.log(`   'explored' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'explored' status FAILED:`, error.message);
  }
  
  // Display: 3. Grepped (Local search - NOT in Vector DB) - 항상 표시
  console.log(`\n📤 [stackTraceLoader] Sending 'grepped' status (${greppedFiles.length} files)...`);
  try {
    await chatAPI.showChatStatus('grepped', {
      filesCount: greppedFiles.length,
      keywords: stackTracePaths.slice(0, stackLimit),
      filesList: greppedFiles.map(f => f.path),
      content: greppedFiles.length > 0
        ? `Grepped: ${greppedFiles.length} files found via local search related to stacktrace`
        : `Grepped: All files found in Vector DB (no local search needed)`
    });
    console.log(`   'grepped' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'grepped' status FAILED:`, error.message);
  }
  
  console.log(`   Stack trace loader: ${stackFiles.length} files loaded\n`);
  return stackFiles;
}
