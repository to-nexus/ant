/**
 * Semantic Search for Context Files
 * 
 * Similar to stack trace loading:
 * 1. Vector DB search (find relevant files)
 * 2. Load from local Git (latest content)
 * 3. Fallback to File Resolver
 */

import { GitPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import type { LoadedFile } from "./stackTraceLoader";

const MAX_SEMANTIC_FILES = 10;

export async function loadSemanticFiles(
  keywords: string[],
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort,
  extractFilesFromCode: (code: string) => Array<{path: string; content: string}>
): Promise<LoadedFile[]> {
  const chatAPI = getChatAPIClient();
  
  if (keywords.length === 0) return [];
  
  console.log(`   🔍 Semantic search (max ${MAX_SEMANTIC_FILES} files)...`);
  
  const searchQuery = keywords.join(' ');
  
  await chatAPI.showChatStatus('retrieving', {
    query: searchQuery
  });
  
  let filePaths: string[] = [];
  let vectorDbSuccess = false;
  
  // Strategy 1: Vector DB search
  try {
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 10000,
        maxFiles: MAX_SEMANTIC_FILES,
        mode: state.mode || 'refactor'
      }
    );
    
    const files = extractFilesFromCode(searchResult.code);
    filePaths = files.map(f => f.path);
    vectorDbSuccess = filePaths.length > 0;
    
    console.log(`   ✅ Vector DB: ${filePaths.length} files retrieved`);
  } catch (e: any) {
    console.warn(`   ⚠️  Vector DB failed: ${e.message}`);
  }
  
  // Strategy 2: File Resolver fallback (for Vector DB misses)
  const missedKeywords: string[] = [];
  
  if (filePaths.length < MAX_SEMANTIC_FILES && keywords.length > 0) {
    console.log(`   🔍 File Resolver: searching for ${MAX_SEMANTIC_FILES - filePaths.length} more files...`);
    
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    for (const keyword of keywords) {
      if (filePaths.length >= MAX_SEMANTIC_FILES) break;
      if (!keyword.includes('.') || keyword.length < 5) continue;
      
      try {
        const resolved = await resolveStackTraceFile(keyword, state.context.workingDir, git);
        
        if (resolved.confidence !== 'not_found') {
          if (!filePaths.includes(resolved.resolvedPath)) {
            filePaths.push(resolved.resolvedPath);
            missedKeywords.push(keyword);
            console.log(`      ✅ File Resolver: ${resolved.resolvedPath}`);
          }
        }
      } catch (e: any) {
        // Silent fail
      }
    }
  }
  
  // Load all files from local Git
  console.log(`   📄 Loading ${filePaths.length} files from local Git...`);
  
  const vectorDbFiles: LoadedFile[] = [];
  const localFiles: LoadedFile[] = [];
  let gitChangesCount = 0;
  
  for (const filePath of filePaths) {
    try {
      const fullPath = require('path').join(state.context.workingDir, filePath);
      const content = await git.readFile(fullPath);
      
      if (content) {
        const isVectorDb = vectorDbSuccess && !missedKeywords.some(k => filePath.includes(k));
        const file: LoadedFile = { path: filePath, content, source: isVectorDb ? 'vector_db' : 'file_resolver' };
        
        if (isVectorDb) {
          vectorDbFiles.push(file);
        } else {
          localFiles.push(file);
        }
        
        // Check if file has git changes
        const hasChanges = await git.hasChanges();
        if (hasChanges) {
          const changedFiles = await git.getChangedFiles();
          if (changedFiles.includes(filePath)) {
            gitChangesCount++;
          }
        }
      } else {
        console.warn(`      ⚠️  Empty or unreadable: ${filePath}`);
      }
    } catch (e: any) {
      console.warn(`      ⚠️  Failed to load: ${filePath} - ${e.message}`);
    }
  }
  
  const semanticFiles = [...vectorDbFiles, ...localFiles];
  console.log(`   ✅ Loaded ${semanticFiles.length} files from local`);
  
  // Display: 1. Retrieved (Vector DB ONLY) - 항상 표시
  await chatAPI.showChatStatus('retrieved', {
    filesCount: vectorDbFiles.length,
    filesList: vectorDbFiles.map(f => f.path)
  });
  
  // Display: 2. Explored (Git changes) - 항상 표시
  await chatAPI.showChatStatus('explored', {
    filesCount: gitChangesCount,
    content: gitChangesCount > 0 
      ? `✅ Explored: ${gitChangesCount} files with uncommitted changes`
      : `✅ Explored: No uncommitted changes`
  });
  
  // Display: 3. Grepped (Local fallback) - 항상 표시
  await chatAPI.showChatStatus('grepped', {
    filesCount: localFiles.length,
    keywords: missedKeywords,
    filesList: localFiles.map(f => f.path)
  });
  
  return semanticFiles;
}
