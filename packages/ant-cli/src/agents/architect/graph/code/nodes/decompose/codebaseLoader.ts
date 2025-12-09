/**
 * RAG Search for Decompose Node
 * 
 * Loads file paths (not content) for task planning
 * Uses two-tier search: stackTrace (priority) + semantic (context)
 */

import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";

export async function loadCodebaseFilePaths(state: ArchitectGraphState): Promise<{
  filePaths: string[];
  gitDiff: any;
}> {
  const stackTrace = state.decomposeKeywords?.stackTrace || [];
  const keywords = state.decomposeKeywords?.keywords || [];
  
  if (stackTrace.length === 0 && keywords.length === 0) {
    return { filePaths: [], gitDiff: undefined };
  }
  
  console.log(`🔍 [Decompose] Two-tier search: ${stackTrace.length} stack trace + ${keywords.length} semantic keywords...`);
  console.log(`   📊 File paths only (NO limit - paths are cheap!)...`);
  
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  
  const chatAPI = getChatAPIClient();
  
  if (!retriever || !vectorDB || !git) {
    console.warn(`⚠️  [Decompose] Retriever, VectorDB, or Git not available, skipping RAG`);
    return { filePaths: [], gitDiff: undefined };
  }
  
  // ✅ Show retrieving status ONCE at the start (before any search)
  const allKeywords: string[] = [];
  if (stackTrace.length > 0) {
    allKeywords.push(...stackTrace.map(f => `[stack] ${f}`));
  }
  if (keywords.length > 0) {
    allKeywords.push(...keywords.map(k => `[semantic] ${k}`));
  }
  
  if (allKeywords.length > 0) {
    await chatAPI.showChatStatus('retrieving', {
      query: allKeywords.slice(0, 20).join(', ') + (allKeywords.length > 20 ? '...' : '')
    });
  }
  
  // Tier 1: Stack trace files (priority, NO LIMIT)
  const stackFiles: string[] = [];
  
  if (stackTrace.length > 0) {
    console.log(`   📍 Stack trace search: ${stackTrace.length} files (loading ALL)...`);
    
    const { resolveStackTraceFile } = await import('../../../../../../core/utils/filePathResolver');
    
    // ✅ Load ALL stack trace files (no limit - paths are cheap)
    for (const filePath of stackTrace) {
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
    
    // Display stack trace results
    await chatAPI.showChatStatus('retrieved', {
      filesCount: stackFiles.length,
      filesList: stackFiles.slice(0, 10),
      content: `Retrieved: ${stackFiles.length} files from stack traces`
    });
    
    await chatAPI.showChatStatus('explored', {
      filesCount: 0,
      content: `Explored: File paths only (no git check for decompose)`
    });
    
    await chatAPI.showChatStatus('grepped', {
      filesCount: 0,
      filesList: [],
      content: `Grepped: All files found via vector search`
    });
  }
  
  // Tier 2: Semantic search (NO LIMIT - paths are cheap)
  let semanticFilePaths: string[] = [];
  let vectorDbFiles: string[] = [];
  let localFiles: string[] = [];
  let missedKeywords: string[] = [];
  
  if (keywords.length > 0) {
    console.log(`   🔍 Semantic search: ${keywords.length} keywords (excluding ${stackFiles.length} stack trace files)...`);
    const searchQuery = keywords.join(' ');
    
    // ✅ Request extra files to compensate for duplicates
    const requestCount = 100 + stackFiles.length;
    
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 50000,  // ✅ High limit - we only need paths, not content
        maxFiles: requestCount,  // ✅ Request extra to compensate for duplicates
        mode: state.mode || 'refactor'
      }
    );
    
    const allVectorFiles = searchResult.files?.map((f: any) => 
      typeof f === 'string' ? f : f.path
    ) || [];
    
    const duplicatesCount = allVectorFiles.filter(f => stackFiles.includes(f)).length;
    
    // ✅ CRITICAL: Exclude stack trace files to avoid duplicates
    vectorDbFiles = allVectorFiles.filter(f => !stackFiles.includes(f));
    
    console.log(`   ✅ Vector DB: ${vectorDbFiles.length} NEW files (${duplicatesCount} duplicates from stack trace excluded)`);
    
    // Display: 1. Retrieved (Vector DB results - EXCLUDING duplicates from stack trace)
    let retrievedMessage: string;
    if (vectorDbFiles.length > 0) {
      retrievedMessage = `Retrieved: ${vectorDbFiles.length} files from semantic search (${duplicatesCount} duplicates excluded)`;
    } else if (stackFiles.length > 0) {
      retrievedMessage = `Retrieved: All matching files already in stack trace results`;
    } else {
      retrievedMessage = `Retrieved: 0 files (Vector DB empty or no matches)`;
    }
    
    await chatAPI.showChatStatus('retrieved', {
      filesCount: vectorDbFiles.length,
      filesList: vectorDbFiles.slice(0, 10),
      content: retrievedMessage
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
        ? `Explored: ${gitChangesCount} files with uncommitted changes related to semantic search`
        : `Explored: No uncommitted changes`
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
  
  // ✅ Merge (already deduplicated - semantic excluded stack trace files)
  const allFiles = [...stackFiles, ...semanticFilePaths];
  const codebaseFilePaths = allFiles;  // No need for Map - already unique!
  
  console.log(`   ✅ Total: ${codebaseFilePaths.length} files (${stackFiles.length} stack trace + ${semanticFilePaths.length} semantic)`);
  
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

