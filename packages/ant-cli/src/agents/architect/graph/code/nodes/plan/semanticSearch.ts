/**
 * Semantic Search for Context Files
 * 
 * Clear 3-tier separation (NO fallback concept):
 * 1. Retrieved: Vector DB search results
 * 2. Explored: Git uncommitted changes (from retrieved files)
 * 3. Grepped: Local file search (NOT in Vector DB)
 */

import { GitPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";
import type { LoadedFile } from "./stackTraceLoader";

export async function loadSemanticFiles(
  keywords: string[],
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort,
  extractFilesFromCode: (code: string) => Array<{path: string; content: string}>,
  excludePaths: string[] = []  // Exclude already loaded (from stacktrace)
): Promise<LoadedFile[]> {
  const chatAPI = getChatAPIClient();
  
  if (keywords.length === 0) return [];
  
  const semanticQuota = RETRIEVAL_CONFIG.getSemanticQuota(excludePaths.length);
  
  if (semanticQuota === 0) {
    console.log(`   ⚠️  Semantic search skipped: quota exhausted (${excludePaths.length}/${RETRIEVAL_CONFIG.TOTAL_MAX} files already loaded from stack trace)`);
    return [];
  }
  
  console.log(`   🔍 Semantic search: ${keywords.length} keywords → quota ${semanticQuota} NEW files (${excludePaths.length} stack trace will be excluded)...`);
  console.log(`   📊 Target: ${excludePaths.length} stack + ${semanticQuota} semantic = ${excludePaths.length + semanticQuota} total files`);
  
  const searchQuery = keywords.join(' ');
  
  await chatAPI.showChatStatus('retrieving', {
    query: searchQuery
  });
  
  let vectorDbPaths: string[] = [];
  let greppedPaths: string[] = [];
  let allVectorFiles: string[] = [];  // ✅ Track all results before filtering
  
  // Step 1: Vector DB search
  try {
    // ✅ CRITICAL: Request MORE files to compensate for expected duplicates
    // If we need 12 NEW files and expect ~20% duplicates, request 15-20 files
    const requestCount = Math.ceil(semanticQuota * 1.5) + excludePaths.length;
    
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 10000,
        maxFiles: requestCount,  // ✅ Request extra to compensate for duplicates
        mode: state.mode || 'refactor'
      }
    );
    
    const files = extractFilesFromCode(searchResult.code);
    allVectorFiles = files.map(f => f.path);
    const duplicatesCount = allVectorFiles.filter(p => excludePaths.includes(p)).length;
    
    // ✅ Filter out stack trace files and apply quota
    vectorDbPaths = allVectorFiles.filter(p => !excludePaths.includes(p)).slice(0, semanticQuota);
    
    console.log(`   ✅ Vector DB: ${vectorDbPaths.length} NEW files (${duplicatesCount} duplicates from stack trace excluded, requested ${requestCount} files)`);
  } catch (e: any) {
    console.warn(`   ⚠️  Vector DB failed: ${e.message}`);
  }
  
  // Step 2: Local files (Git changes + Keyword fallback)
  // Priority: Git uncommitted files (faster, more accurate)
  // Fallback: Keyword-based file search
  let localFilePaths: string[] = [];
  
  try {
    const hasChanges = await git.hasChanges();
    if (hasChanges) {
      const changedFiles = await git.getChangedFiles();
      // Filter to only include files not already in excludePaths or vectorDbPaths
      const gitChangedPaths = changedFiles.filter(f => 
        !excludePaths.includes(f) && 
        !vectorDbPaths.includes(f)
      );
      
      if (gitChangedPaths.length > 0) {
        console.log(`   📝 Git uncommitted files: ${gitChangedPaths.length} files found`);
        console.log(`      Loading uncommitted files for context...`);
        localFilePaths.push(...gitChangedPaths);
      }
    }
  } catch (e: any) {
    console.warn(`   ⚠️  Git changes check failed: ${e.message}`);
  }
  
  // Step 3: Local file search for remaining keywords (if still need more files)
  const remainingQuota = semanticQuota - vectorDbPaths.length - localFilePaths.length;
  if (remainingQuota > 0 && keywords.length > 0) {
    console.log(`   🔍 Local keyword search: ${remainingQuota} slots remaining...`);
    
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    const keywordSearchPaths: string[] = [];
    for (const keyword of keywords) {
      if (keywordSearchPaths.length >= remainingQuota) break;
      if (!keyword.includes('.') || keyword.length < 5) continue;
      
      try {
        const resolved = await resolveStackTraceFile(keyword, state.context.workingDir, git);
        
        if (resolved.confidence !== 'not_found') {
          // ✅ Check if not already loaded (from stacktrace, vectorDB, or git changes)
          if (!excludePaths.includes(resolved.resolvedPath) && 
              !vectorDbPaths.includes(resolved.resolvedPath) &&
              !localFilePaths.includes(resolved.resolvedPath)) {
            keywordSearchPaths.push(resolved.resolvedPath);
            console.log(`      ✅ Keyword search: ${resolved.resolvedPath}`);
          }
        }
      } catch (e: any) {
        // Silent fail
      }
    }
    
    localFilePaths.push(...keywordSearchPaths);
  }
  
  // Step 4: Load all files from local Git and categorize
  const totalFilesToLoad = vectorDbPaths.length + localFilePaths.length;
  console.log(`   📄 Loading ${totalFilesToLoad} files from local Git...`);
  
  const vectorDbFiles: LoadedFile[] = [];
  const localFiles: LoadedFile[] = [];
  const allPaths = [...vectorDbPaths, ...localFilePaths];
  
  for (const filePath of allPaths) {
    try {
      const fullPath = require('path').join(state.context.workingDir, filePath);
      const content = await git.readFile(fullPath);
      
      if (content) {
        const isVectorDb = vectorDbPaths.includes(filePath);
        const file: LoadedFile = { 
          path: filePath, 
          content, 
          source: isVectorDb ? 'vector_db' : 'local'
        };
        
        if (isVectorDb) {
          vectorDbFiles.push(file);
        } else {
          localFiles.push(file);
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
  
  // exploredFiles = subset of Vector DB files that have uncommitted changes
  // (for Chat UI display to show which retrieved files were modified)
  let exploredFiles: string[] = [];
  if (localFiles.length > 0 && vectorDbFiles.length > 0) {
    const localSet = new Set(localFiles.map(f => f.path));
    exploredFiles = vectorDbFiles.filter(f => localSet.has(f.path)).map(f => f.path);
  }
  
  // Display: 1. Retrieved (Vector DB ONLY - EXCLUDING duplicates from stack trace) - 항상 표시
  const duplicatesFromStack = allVectorFiles.length - vectorDbPaths.length;
  console.log(`\n📤 [semanticSearch] Sending 'retrieved' status (${vectorDbFiles.length} NEW files, ${duplicatesFromStack} duplicates excluded)...`);
  try {
    let retrievedMessage: string;
    if (vectorDbFiles.length > 0) {
      retrievedMessage = `Retrieved: ${vectorDbFiles.length} NEW files from semantic search (${duplicatesFromStack} duplicates from stack trace excluded)`;
    } else if (excludePaths.length > 0) {
      retrievedMessage = `Retrieved: All matching files already in stack trace results`;
    } else {
      retrievedMessage = `Retrieved: 0 files (Vector DB empty or no matches)`;
    }
    
    await chatAPI.showChatStatus('retrieved', {
      filesCount: vectorDbFiles.length,
      filesList: vectorDbFiles.map(f => f.path),
      content: retrievedMessage
    });
    console.log(`   ✅ 'retrieved' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'retrieved' status FAILED:`, error.message);
  }
  
  // Display: 2. Explored (Git changes in retrieved files) - 항상 표시
  console.log(`\n📤 [semanticSearch] Sending 'explored' status (${exploredFiles.length} files)...`);
  try {
    await chatAPI.showChatStatus('explored', {
      filesCount: exploredFiles.length,
      filesList: exploredFiles,
      content: exploredFiles.length > 0 
        ? `Explored: ${exploredFiles.length} files with uncommitted changes related to semantic`
        : `Explored: No uncommitted changes related to semantic`
    });
    console.log(`   'explored' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'explored' status FAILED:`, error.message);
  }
  
  // Display: 3. Grepped (Local files - NOT in Vector DB) - 항상 표시
  console.log(`\n📤 [semanticSearch] Sending 'grepped' status (${localFiles.length} files)...`);
  try {
    let greppedMessage: string;
    
    if (localFiles.length > 0) {
      greppedMessage = `Grepped: ${localFiles.length} local files`;
    } else {
      greppedMessage = vectorDbFiles.length > 0 
        ? `Grepped: All files found in Vector DB (no local search needed)`
        : `Grepped: 0 files (no matches)`;
    }
    
    await chatAPI.showChatStatus('grepped', {
      filesCount: localFiles.length,
      keywords: keywords,
      filesList: localFiles.map(f => f.path),
      content: greppedMessage
    });
    console.log(`   'grepped' status sent successfully\n`);
  } catch (error: any) {
    console.error(`   ❌ 'grepped' status FAILED:`, error.message);
  }
  
  console.log(`   Semantic loader: ${semanticFiles.length} files loaded (quota was ${semanticQuota})\n`);
  return semanticFiles;
}
