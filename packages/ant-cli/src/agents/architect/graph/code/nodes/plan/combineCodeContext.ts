/**
 * Combine Code Context (RAG)
 * 
 * Single responsibility: Combine code files from multiple sources for the current task
 * 
 * 3-tier approach:
 * 1. Vector DB search (find relevant file paths)
 * 2. Git changed files (ensure latest local changes)
 * 3. Local file read (always read from disk for latest content)
 * 
 * Sources combined:
 * - Stack trace files (error context)
 * - Semantic search files (keyword matches)
 * - Git uncommitted changes (latest modifications)
 * 
 * This guarantees 100% local latest content.
 */

import { GitPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { loadStackTraceFiles, LoadedFile } from "./stackTraceLoader";
import { loadSemanticFiles } from "./semanticSearch";
import { extractFilesFromCode } from "./utils";

export interface ProjectCodeContext {
  filePaths: string[];
  files: Array<{ path: string; content: string; source: 'vector_db' | 'local' }>;
  stats: {
    filesLoaded: number;
    stackTraceCount: number;
    semanticCount: number;
    deduplicatedCount: number;
    estimatedTokens?: number;
  };
  gitDiff?: string;
  source: 'plan';
}

export interface TaskKeywords {
  stackTrace: string[];
  keywords: string[];
}

/**
 * Combine project code context from multiple sources using RAG
 * 
 * Combines files from:
 * - Stack trace analysis (error context)
 * - Semantic search (Vector DB keyword matches)
 * - Git uncommitted changes (local modifications)
 * 
 * All file content is read from local disk to guarantee latest version.
 * 
 * @param taskKeywords - Stack trace paths and semantic keywords
 * @param state - Current graph state
 * @param retriever - Vector DB retriever
 * @param vectorDB - Vector database instance
 * @param git - Git port for file operations
 * @returns ProjectCodeContext with combined files (latest local content)
 */
export async function combineCodeContext(
  taskKeywords: TaskKeywords,
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort
): Promise<ProjectCodeContext | null> {
  const hasStackTrace = taskKeywords.stackTrace.length > 0;
  const hasKeywords = taskKeywords.keywords.length > 0;
  
  // If no keywords, return null (caller will create empty context)
  if (!hasStackTrace && !hasKeywords) {
    console.log(`   ℹ️  No stack trace or keywords - skipping RAG`);
    return null;
  }
  
  console.log(`🔍 [RAG] Two-tier search (stackTrace → semantic)...`);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 1: Stack trace files (priority)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const stackFiles = await loadStackTraceFiles(
    taskKeywords.stackTrace,
    state,
    retriever,
    vectorDB,
    git,
    extractFilesFromCode
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 2: Semantic files (context, dynamic quota)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const semanticFiles = await loadSemanticFiles(
    taskKeywords.keywords,
    state,
    retriever,
    vectorDB,
    git,
    extractFilesFromCode,
    stackFiles.map(f => f.path)  // ✅ Exclude already loaded - avoid duplicate content
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Merge & Deduplicate
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Stack trace files come first (priority), then semantic
  const allFiles = [...stackFiles, ...semanticFiles];
  const uniqueFiles = Array.from(
    new Map(allFiles.map(f => [f.path, f])).values()
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Create context object
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const projectCodeContext: ProjectCodeContext = {
    filePaths: uniqueFiles.map(f => f.path),
    files: uniqueFiles,
    stats: {
      filesLoaded: uniqueFiles.length,
      stackTraceCount: stackFiles.length,
      semanticCount: semanticFiles.length,
      deduplicatedCount: allFiles.length - uniqueFiles.length
    },
    source: 'plan' as const
  };
  
  console.log(`   ✅ Total: ${projectCodeContext.stats.filesLoaded} files (${stackFiles.length} stack + ${semanticFiles.length} semantic)`);
  if (projectCodeContext.stats.deduplicatedCount > 0) {
    console.log(`   🔄 Deduplicated: ${projectCodeContext.stats.deduplicatedCount} duplicates removed`);
  }
  
  if (projectCodeContext.filePaths.length > 0) {
    projectCodeContext.filePaths.forEach((f: string) => console.log(`      📄 ${f}`));
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Git diff summary
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (git) {
    const { generateGitDiffSummary } = require('../../../../../../core/codebase/GitDiffSummary');
    projectCodeContext.gitDiff = await generateGitDiffSummary(
      git, 
      state.context.workingDir, 
      projectCodeContext.filePaths
    );
  }
  
  return projectCodeContext;
}
