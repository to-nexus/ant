/**
 * RAG Search for Decompose Node
 * 
 * Loads file paths (not content) for task planning
 */

import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export async function loadCodebaseFilePaths(state: ArchitectGraphState): Promise<{
  filePaths: string[];
  gitDiff: any;
}> {
  const stackTrace = state.decomposeKeywords?.stackTrace || [];
  const keywords = state.decomposeKeywords?.keywords || [];
  
  if (stackTrace.length === 0 && keywords.length === 0) {
    return { filePaths: [], gitDiff: undefined };
  }
  
  console.log(`🔍 [Decompose] Searching with ${stackTrace.length} stack trace files + ${keywords.length} semantic keywords...`);
  
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  
  const chatAPI = getChatAPIClient();
  
  if (!retriever || !vectorDB || !git) {
    console.warn(`⚠️  [Decompose] Retriever, VectorDB, or Git not available, skipping RAG`);
    return { filePaths: [], gitDiff: undefined };
  }
  
  // Tier 1: Stack trace files (max 5)
  const MAX_STACK_TRACE_FILES = 5;
  const stackFiles: string[] = [];
  
  if (stackTrace.length > 0) {
    console.log(`   📍 Loading ${stackTrace.length} stack trace files (max ${MAX_STACK_TRACE_FILES})...`);
    
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    for (const filePath of stackTrace.slice(0, MAX_STACK_TRACE_FILES)) {
      let loaded = false;
      
      // Strategy 1: Vector DB search
      try {
        console.log(`      🔍 Vector search: ${filePath}`);
        const vectorResult = await retriever.retrieve(
          filePath,
          state.context.workingDir,
          { vectorDB, git },
          { project: state.context.project, maxTokens: 8000, maxFiles: 1, mode: 'refactor' }
        );
        
        const files = vectorResult.files?.map((f: any) => typeof f === 'string' ? f : f.path) || [];
        if (files.length > 0) {
          stackFiles.push(files[0]);
          console.log(`      ✅ Vector DB: ${files[0]}`);
          loaded = true;
        }
      } catch (e: any) {
        console.warn(`      ⚠️  Vector search failed: ${e.message}`);
      }
      
      // Strategy 2: File Path Resolver
      if (!loaded) {
        try {
          console.log(`      🔍 File resolver: ${filePath}`);
          const resolved = await resolveStackTraceFile(filePath, state.context.workingDir, git);
          
          if (resolved.confidence !== 'not_found') {
            stackFiles.push(resolved.resolvedPath);
            console.log(`      ✅ File resolver (${resolved.confidence}): ${resolved.resolvedPath}`);
            if (resolved.candidates && resolved.candidates.length > 1) {
              console.log(`         📋 Other candidates: ${resolved.candidates.filter(c => c !== resolved.resolvedPath).slice(0, 3).join(', ')}`);
            }
            loaded = true;
          }
        } catch (e: any) {
          console.warn(`      ⚠️  File resolver failed: ${e.message}`);
        }
      }
      
      if (!loaded) {
        console.error(`      ❌ FAILED to load: ${filePath}`);
      }
    }
  }
  
  // Tier 2: Semantic search (max 10)
  const MAX_SEMANTIC_FILES = 10;
  let semanticFilePaths: string[] = [];
  let vectorDbFiles: string[] = [];
  let localFiles: string[] = [];
  let missedKeywords: string[] = [];
  
  if (keywords.length > 0) {
    console.log(`   🔍 Semantic search for ${keywords.length} keywords (max ${MAX_SEMANTIC_FILES} files)...`);
    const searchQuery = keywords.join(' ');
    
    await chatAPI.showChatStatus('retrieving', {
      query: searchQuery
    });
    
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 8000,
        maxFiles: MAX_SEMANTIC_FILES,
        mode: state.mode || 'refactor'
      }
    );
    
    vectorDbFiles = searchResult.files?.map((f: any) => 
      typeof f === 'string' ? f : f.path
    ) || [];
    
    // Display: 1. Retrieved (Vector DB results)
    await chatAPI.showChatStatus('retrieved', {
      filesCount: vectorDbFiles.length,
      filesList: vectorDbFiles.slice(0, 10)
    });
    
    // Check for uncommitted changes (explored)
    let gitChangesCount = 0;
    if (git && vectorDbFiles.length > 0) {
      try {
        const changedFiles = await git.getChangedFiles();
        const changedFileSet = new Set(changedFiles);
        gitChangesCount = vectorDbFiles.filter(f => changedFileSet.has(f)).length;
      } catch (e: any) {
        console.warn(`      ⚠️  Git changes check failed: ${e.message}`);
      }
    }
    
    // Display: 2. Explored (Git changes) - 항상 표시
    await chatAPI.showChatStatus('explored', {
      filesCount: gitChangesCount,
      content: gitChangesCount > 0 
        ? `✅ Explored: ${gitChangesCount} files with uncommitted changes`
        : `✅ Explored: No uncommitted changes`
    });
    
    // Local file search fallback (grepped) for file-like keywords
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    for (const keyword of keywords) {
      // Check if keyword looks like a file name
      if (keyword.includes('.') || keyword.includes('/')) {
        const foundInVector = vectorDbFiles.some(f => f.includes(keyword));
        
        if (!foundInVector) {
          // Try to resolve locally
          try {
            const resolved = await resolveStackTraceFile(keyword, state.context.workingDir, git);
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
    
    // Display: 3. Grepped (Local fallback) - 항상 표시
    await chatAPI.showChatStatus('grepped', {
      filesCount: localFiles.length,
      keywords: missedKeywords,
      filesList: localFiles
    });
    
    semanticFilePaths = [...vectorDbFiles, ...localFiles];
  }
  
  // Merge and deduplicate
  const allFiles = [...stackFiles, ...semanticFilePaths];
  const uniqueFilesMap = new Map<string, string>();
  for (const filePath of allFiles) {
    uniqueFilesMap.set(filePath, filePath);
  }
  const codebaseFilePaths = Array.from(uniqueFilesMap.values());
  
  console.log(`   ✅ Retrieved ${codebaseFilePaths.length} files (${stackFiles.length} stack trace + ${codebaseFilePaths.length - stackFiles.length} semantic)`);
  
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

