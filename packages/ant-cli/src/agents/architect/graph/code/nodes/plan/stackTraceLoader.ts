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

export interface LoadedFile {
  path: string;
  content: string;
  source: 'vector_db' | 'file_resolver';
}

const MAX_STACK_TRACE_FILES = 5;

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
  
  console.log(`   📍 Loading ${stackTracePaths.length} stack trace files (max ${MAX_STACK_TRACE_FILES})...`);
  
  await chatAPI.showChatStatus('retrieving', {
    query: `Stack trace: ${stackTracePaths.join(', ')}`
  });
  
  const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
  
  for (const filePath of stackTracePaths.slice(0, MAX_STACK_TRACE_FILES)) {
    let resolvedPath: string | null = null;
    let source: 'vector_db' | 'file_resolver' | null = null;
    
    // Strategy 1: Vector DB search
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
    
    // Strategy 2: File Resolver
    if (!resolvedPath) {
      try {
        console.log(`      🔍 File Resolver: ${filePath}`);
        const resolved = await resolveStackTraceFile(filePath, state.context.workingDir, git);
        
        if (resolved.confidence !== 'not_found') {
          resolvedPath = resolved.resolvedPath;
          source = 'file_resolver';
          console.log(`      ✅ File Resolver (${resolved.confidence}): ${resolvedPath}`);
          if (resolved.candidates && resolved.candidates.length > 1) {
            console.log(`         📋 Other candidates: ${resolved.candidates.filter(c => c !== resolvedPath).slice(0, 3).join(', ')}`);
          }
        }
      } catch (e: any) {
        console.warn(`      ⚠️  File Resolver failed: ${e.message}`);
      }
    }
    
    // Load from local Git (ALWAYS)
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
  
  // Display in Chat UI - 항상 표시
  const vectorDbFiles = stackFiles.filter(f => f.source === 'vector_db');
  const resolverFiles = stackFiles.filter(f => f.source === 'file_resolver');
  
  let fileListDisplay = '📍 **Stack Trace Files**\n\n';
  
  if (stackFiles.length === 0) {
    fileListDisplay += 'No stack trace files found';
  } else {
    if (vectorDbFiles.length > 0) {
      fileListDisplay += `🗄️ **Retrieved from Vector DB** (${vectorDbFiles.length}):\n`;
      vectorDbFiles.forEach(f => { fileListDisplay += `  • ${f.path}\n`; });
      if (resolverFiles.length > 0) fileListDisplay += '\n';
    }
    
    if (resolverFiles.length > 0) {
      fileListDisplay += `📁 **Resolved via File System** (${resolverFiles.length}):\n`;
      resolverFiles.forEach(f => { fileListDisplay += `  • ${f.path}\n`; });
    }
    
    fileListDisplay += `\n💾 **All loaded from local Git** (includes uncommitted changes)`;
  }
  
  // Display: 1. Retrieved (Stack trace files)
  await chatAPI.showChatStatus('retrieved', {
    content: fileListDisplay,
    filesCount: stackFiles.length,
    filesList: stackFiles.map(f => f.path)
  });
  
  // Display: 2. Explored (Git changes for stack trace files) - 항상 표시
  let gitChangesCount = 0;
  if (stackFiles.length > 0) {
    try {
      const changedFiles = await git.getChangedFiles();
      const changedFileSet = new Set(changedFiles);
      gitChangesCount = stackFiles.filter(f => changedFileSet.has(f.path)).length;
    } catch (e: any) {
      console.warn(`      ⚠️  Git changes check failed: ${e.message}`);
    }
  }
  
  await chatAPI.showChatStatus('explored', {
    filesCount: gitChangesCount,
    content: gitChangesCount > 0 
      ? `✅ Explored: ${gitChangesCount} stack trace files with uncommitted changes`
      : `✅ Explored: No uncommitted changes in stack trace files`
  });
  
  // Display: 3. Grepped (File resolver was the fallback) - 항상 표시
  await chatAPI.showChatStatus('grepped', {
    filesCount: resolverFiles.length,
    keywords: stackTracePaths.filter((_, i) => i < MAX_STACK_TRACE_FILES),
    filesList: resolverFiles.map(f => f.path),
    content: resolverFiles.length > 0
      ? `✅ Grepped: ${resolverFiles.length} files found via local file system`
      : `✅ Grepped: All files found in Vector DB (no local fallback needed)`
  });
  
  return stackFiles;
}
