/**
 * RAG Search for Decompose Node
 * 
 * Loads file paths (not content) for task planning
 * Uses two-tier search: errorFiles (priority) + semantic (context)
 */

import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";

export async function loadCodebaseFilePaths(state: ArchitectGraphState): Promise<{
  filePaths: string[];
  gitDiff: any;
}> {
  const errorFiles = state.decomposeKeywords?.errorFiles || [];
  const keywords = state.decomposeKeywords?.keywords || [];
  
  if (errorFiles.length === 0 && keywords.length === 0) {
    return { filePaths: [], gitDiff: undefined };
  }
  
  console.log(`🔍 [Decompose] Two-tier search: ${errorFiles.length} error files + ${keywords.length} semantic keywords...`);
  console.log(`   📊 File paths only (NO limit - paths are cheap!)...`);
  
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  const fileSystem = state.deps?.fileSystem;
  
  const chatAPI = getChatAPIClient();
  
  if (!retriever || !vectorDB || !git || !fileSystem) {
    console.warn(`⚠️  [Decompose] Retriever, VectorDB, Git, or FileSystem not available, skipping RAG`);
    return { filePaths: [], gitDiff: undefined };
  }
  
  // ✅ Show retrieving status ONCE at the start (before any search)
  const allKeywords: string[] = [];
  if (errorFiles.length > 0) {
    allKeywords.push(...errorFiles.map((f: string) => `[error] ${f}`));
  }
  if (keywords.length > 0) {
    allKeywords.push(...keywords.map((k: string) => `[semantic] ${k}`));
  }
  
  // Declare retrieving index outside the if block so it's accessible later
  let retrievingIndex: number | undefined;
  if (allKeywords.length > 0) {
    retrievingIndex = await chatAPI.showChatStatus('retrieving', {
      query: allKeywords.slice(0, 20).join(', ') + (allKeywords.length > 20 ? '...' : '')
    });
  }
  
  // Tier 1: Stack trace files (priority, NO LIMIT)
  const errorFilesResult: string[] = [];
  
  if (errorFiles.length > 0) {
    console.log(`   📍 Error files: ${errorFiles.length} files (loading from local)...`);
    
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    // ✅ Load error files directly from local (no Vector DB - exact paths!)
    for (const filePath of errorFiles) {
      try {
        console.log(`      🔍 Local file: ${filePath}`);
        const resolved = await resolveStackTraceFile(filePath, state.context.workingDir, git, fileSystem);
        
        if (resolved.confidence !== 'not_found') {
          errorFilesResult.push(resolved.resolvedPath);
          console.log(`      ✅ Loaded (${resolved.confidence}): ${resolved.resolvedPath}`);
          if (resolved.candidates && resolved.candidates.length > 1) {
            console.log(`         📋 Other candidates: ${resolved.candidates.filter(c => c !== resolved.resolvedPath).slice(0, 3).join(', ')}`);
          }
        } else {
          console.error(`      ❌ FAILED to resolve: ${filePath}`);
        }
      } catch (e: any) {
        console.warn(`      ⚠️  Failed to load: ${e.message}`);
      }
    }
    
    // Display error files results
    await chatAPI.showChatStatus('retrieved', {
      filesCount: 0,
      filesList: [],
      content: `Retrieved: Error files loaded from local only (no Vector DB)`,
      _mergeIndex: retrievingIndex
    });
    
    // ✅ CRITICAL: Must send 'exploring' first for proper merge!
    const exploringIndex1 = await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('explored', {
      filesCount: 0,
      content: `Explored: No git check for decompose`,
      _mergeIndex: exploringIndex1
    });
    
    const greppingIndex1 = await chatAPI.showChatStatus('grepping', { totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', {
      filesCount: errorFilesResult.length,
      filesList: errorFilesResult.slice(0, 10),
      content: `Grepped: ${errorFilesResult.length} error files from local`,
      _mergeIndex: greppingIndex1
    });
  }
  
  // Tier 2: Semantic search (NO LIMIT - paths are cheap)
  let semanticFilePaths: string[] = [];
  let vectorDbFiles: string[] = [];
  let localFiles: string[] = [];
  let missedKeywords: string[] = [];
  
  if (keywords.length > 0) {
    console.log(`   🔍 Semantic search: ${keywords.length} keywords (excluding ${errorFilesResult.length} stack trace files)...`);
    const searchQuery = keywords.join(' ');
    
    // ✅ Request extra files to compensate for duplicates
    const requestCount = 100 + errorFilesResult.length;
    
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 50000,  // ✅ High limit - we only need paths, not content
        maxFiles: requestCount,  // ✅ Request extra to compensate for duplicates
        mode: state.detectionReport?.jobMode || 'refactor'
      }
    );
    
    const allVectorFiles = searchResult.files?.map((f: any) => 
      typeof f === 'string' ? f : f.path
    ) || [];
    
    const duplicatesCount = allVectorFiles.filter(f => errorFilesResult.includes(f)).length;
    
    // ✅ CRITICAL: Exclude stack trace files to avoid duplicates
    vectorDbFiles = allVectorFiles.filter(f => !errorFilesResult.includes(f));
    
    console.log(`   ✅ Vector DB: ${vectorDbFiles.length} files (${duplicatesCount} duplicates from stack trace excluded)`);
    
    // Display: 1. Retrieved (Vector DB results - EXCLUDING duplicates from stack trace)
    let retrievedMessage: string;
    if (vectorDbFiles.length > 0) {
      retrievedMessage = `Retrieved: ${vectorDbFiles.length} files from semantic search (${duplicatesCount} duplicates excluded)`;
    } else if (errorFilesResult.length > 0) {
      retrievedMessage = `Retrieved: All matching files already in stack trace results`;
    } else {
      retrievedMessage = `Retrieved: 0 files (Vector DB empty or no matches)`;
    }
    
    await chatAPI.showChatStatus('retrieved', {
      filesCount: vectorDbFiles.length,
      filesList: vectorDbFiles.slice(0, 10),
      content: retrievedMessage,
      _mergeIndex: retrievingIndex
    });
    
    // Step 2: Explored - Git changes + added (all uncommitted files)
    // ✅ REDESIGNED: Include ALL git changes (modified + created + deleted + untracked)
    let gitAllChanges: string[] = [];
    try {
      const changedFiles = await git.getChangedFiles();
      gitAllChanges = changedFiles.filter(f => 
        !errorFilesResult.includes(f) &&  // Not in stack trace
        !vectorDbFiles.includes(f)        // Not in Vector DB (avoid duplicates)
      );
      
      if (gitAllChanges.length > 0) {
        console.log(`      ✅ Git changes + added: ${gitAllChanges.length} files (new/modified from previous tasks)`);
        gitAllChanges.slice(0, 10).forEach(p => console.log(`         - ${p}`));
        if (gitAllChanges.length > 10) {
          console.log(`         ... and ${gitAllChanges.length - 10} more`);
        }
        localFiles.push(...gitAllChanges);
      }
    } catch (e: any) {
      console.warn(`      ⚠️  Git changes check failed: ${e.message}`);
    }
    
    // Display: 2. Explored (Git changes + added)
    const exploringIndex2 = await chatAPI.showChatStatus('exploring', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('explored', {
      filesCount: gitAllChanges.length,
      content: gitAllChanges.length > 0 
        ? `Explored: ${gitAllChanges.length} files (git changes + added)`
        : `Explored: No uncommitted changes`,
      filesList: gitAllChanges.slice(0, 20),
      _mergeIndex: exploringIndex2
    });
    
    // Step 3: Grepped - Pure local search (fallback for non-git or remaining files)
    // ✅ REDESIGNED: File-like keywords resolution only
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    for (const keyword of keywords) {
      // Check if keyword looks like a file name
      if (keyword.includes('.') || keyword.includes('/')) {
        const foundInVector = vectorDbFiles.some(f => f.includes(keyword));
        const foundInLocal = localFiles.some(f => f.includes(keyword));
        
        if (!foundInVector && !foundInLocal) {
          // Try to resolve locally
          try {
            const resolved = await resolveStackTraceFile(keyword, state.context.workingDir, git, fileSystem);
            if (resolved.confidence !== 'not_found') {
              localFiles.push(resolved.resolvedPath);
              console.log(`      ✅ Local fallback: ${resolved.resolvedPath} (${keyword})`);
            } else {
              missedKeywords.push(keyword);
            }
          } catch (e: any) {
            missedKeywords.push(keyword);
          }
        }
      }
    }
    
    // Display: 3. Grepped (Local fallback)
    const greppedCount = localFiles.length - gitAllChanges.length;  // Only count non-git files
    const greppingIndex2 = await chatAPI.showChatStatus('grepping', { filesCount: 0, totalFiles: 0 });
    await chatAPI.showChatStatus('grepped', {
      filesCount: greppedCount,
      keywords: missedKeywords,
      filesList: greppedCount > 0 ? localFiles.slice(gitAllChanges.length, gitAllChanges.length + 20) : [],
      _mergeIndex: greppingIndex2
    });
    
    semanticFilePaths = [...vectorDbFiles, ...localFiles];
  }
  
  // ✅ Merge (already deduplicated - semantic excluded stack trace files)
  const allFiles = [...errorFilesResult, ...semanticFilePaths];
  const codebaseFilePaths = allFiles;  // No need for Map - already unique!
  
  console.log(`   ✅ Total: ${codebaseFilePaths.length} files (${errorFilesResult.length} stack trace + ${semanticFilePaths.length} semantic)`);
  
  // Git diff summary
  let gitDiffResult: any = undefined;
  if (git && codebaseFilePaths.length > 0) {
    const { generateGitDiffSummary } = await import('../../../../../../core/codebase/GitDiffSummary');
    gitDiffResult = await generateGitDiffSummary(git, state.context.workingDir, codebaseFilePaths);
  }
  
  return {
    filePaths: codebaseFilePaths,
    gitDiff: gitDiffResult
  };
}

