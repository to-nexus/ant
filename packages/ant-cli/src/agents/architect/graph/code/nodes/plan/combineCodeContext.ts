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

import path from "path";
import { GitPort, FileSystemPort } from "../../../../../../core/ports";
import { ArchitectGraphState } from "../../state";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";
import { loadErrorFiles, LoadedFile } from "./errorFilesLoader";
import { loadSemanticFiles, LessonResult } from "./semanticSearch";
import { extractFilesFromCode } from "./utils";
import { generateGitDiffSummary, GitDiffSummary } from "../../../../../../core/codebase/GitDiffSummary";

export interface ProjectCodeContext {
  filePaths: string[];
  files: Array<{ path: string; content: string; source: 'vector_db' | 'local' }>;
  stats: {
    filesLoaded: number;
    errorFilesCount: number;
    semanticCount: number;
    deduplicatedCount: number;
    estimatedTokens?: number;
  };
  gitDiff?: GitDiffSummary;
  directoryTree?: string;  // ✅ Directory structure for path decisions
  source: 'plan';
}

// ✅ Extended return type to include lessons
export interface CombinedCodeContextResult {
  context: ProjectCodeContext;
  lessons: LessonResult[];
}

export interface TaskKeywords {
  errorFiles: string[];
  keywords: string[];
  requiredFiles: string[];  // Specific file paths to force-load (from directory tree selection)
  references?: Map<string, string[]>;  // Optional reference project keywords
}

/**
 * Combine project code context from multiple sources using RAG
 * 
 * Combines files from:
 * - Error files (from violations)
 * - Semantic search (Vector DB keyword matches)
 * - Git uncommitted changes (local modifications)
 * 
 * All file content is read from local disk to guarantee latest version.
 * 
 * @param taskKeywords - Error file paths and semantic keywords
 * @param state - Current graph state
 * @param retriever - Vector DB retriever
 * @param vectorDB - Vector database instance
 * @param git - Git port for file operations
 * @returns CombinedCodeContextResult with combined files (latest local content) and lessons
 */
export async function combineCodeContext(
  taskKeywords: TaskKeywords,
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort,
  directoryTree?: string
): Promise<CombinedCodeContextResult | null> {
  const hasStackTrace = taskKeywords.errorFiles.length > 0;
  const hasKeywords = taskKeywords.keywords.length > 0;
  const hasRequiredFiles = taskKeywords.requiredFiles.length > 0;
  
  // If nothing to search for, return null (caller will create empty context)
  if (!hasStackTrace && !hasKeywords && !hasRequiredFiles) {
    console.log(`   ℹ️  No required files, stack trace, or keywords - skipping RAG`);
    return null;
  }
  
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    console.warn(`   ⚠️  FileSystemPort not available, skipping RAG`);
    return null;
  }
  
  console.log(`🔍 [RAG] Three-tier search (requiredFiles → errorFiles → semantic)...`);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 0: Required files (highest priority - direct load, no quota)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const requiredFiles = await loadRequiredFiles(
    taskKeywords.requiredFiles,
    state,
    fileSystem
  );
  
  if (requiredFiles.length > 0) {
    console.log(`   📄 Required files: ${requiredFiles.length} loaded directly`);
    requiredFiles.forEach(f => console.log(`      - ${f.path}`));
    
    // ✅ Show in Chat UI
    try {
      const chatAPI = getChatAPIClient();
      const loadMergeIndex = await chatAPI.showChatStatus('loading', {
        filesCount: 0
      });
      await chatAPI.showChatStatus('loaded', {
        filesCount: requiredFiles.length,
        filesList: requiredFiles.map(f => f.path),
        content: `Loaded: ${requiredFiles.length} required files`,
        _mergeIndex: loadMergeIndex
      });
    } catch {
      // Non-critical: UI update failed
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 1: Error files (priority - from violations)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const errorFiles = await loadErrorFiles(
    taskKeywords.errorFiles,
    state,
    git,
    fileSystem
  );
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Tier 2: Semantic files (context, dynamic quota)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ✅ Exclude both requiredFiles and errorFiles from semantic quota
  const excludePaths = [
    ...requiredFiles.map(f => f.path),
    ...errorFiles.map(f => f.path)
  ];
  
  const semanticResult = await loadSemanticFiles(
    taskKeywords.keywords,
    state,
    retriever,
    vectorDB,
    git,
    extractFilesFromCode,
    excludePaths
  );
  
  const semanticFiles = semanticResult.files;
  const lessons = semanticResult.lessons;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Merge & Deduplicate
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Priority order: requiredFiles > errorFiles > semanticFiles
  const allFiles = [...requiredFiles, ...errorFiles, ...semanticFiles];
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
      errorFilesCount: errorFiles.length,
      semanticCount: semanticFiles.length,
      deduplicatedCount: allFiles.length - uniqueFiles.length
    },
    source: 'plan' as const
  };
  
  console.log(`   ✅ Total: ${projectCodeContext.stats.filesLoaded} files (${requiredFiles.length} required + ${errorFiles.length} error + ${semanticFiles.length} semantic)`);
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
    const gitDiffResult = await generateGitDiffSummary(
      git, 
      state.context.workingDir, 
      projectCodeContext.filePaths
    );
    projectCodeContext.gitDiff = gitDiffResult ?? undefined;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Directory tree (reuse pre-generated or generate fresh)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (directoryTree) {
    projectCodeContext.directoryTree = directoryTree;
    console.log(`   📂 Directory tree reused from earlier generation`);
  } else {
    try {
      projectCodeContext.directoryTree = await generateDirectoryTree(fileSystem, 4);
      if (projectCodeContext.directoryTree) {
        console.log(`   📂 Directory tree generated`);
      }
    } catch (err) {
      console.warn(`   ⚠️  Could not generate directory tree:`, err instanceof Error ? err.message : err);
    }
  }
  
  // ✅ Return both context and lessons
  return {
    context: projectCodeContext,
    lessons
  };
}

/**
 * Load required files directly from filesystem (no search needed)
 * 
 * These are files explicitly selected by the keyword LLM from the directory tree.
 * They are loaded with highest priority and do not consume semantic search quota.
 * 
 * @param filePaths - Relative file paths from codebase root
 * @param state - Current graph state
 * @param fileSystem - FileSystemPort for file access
 * @returns Array of loaded files
 */
async function loadRequiredFiles(
  filePaths: string[],
  state: ArchitectGraphState,
  fileSystem: FileSystemPort
): Promise<LoadedFile[]> {
  const MAX_REQUIRED = 10;
  const files: LoadedFile[] = [];
  
  if (filePaths.length === 0) return files;
  
  const rootPath = fileSystem.getRootPath();
  
  for (const filePath of filePaths.slice(0, MAX_REQUIRED)) {
    try {
      const fullPath = path.join(state.context.workingDir, filePath);
      const relativePath = path.relative(rootPath, fullPath);
      const content = await fileSystem.readFile(relativePath);
      if (content) {
        files.push({ path: filePath, content, source: 'local' });
      } else {
        console.warn(`      ⚠️  Required file empty or not found: ${filePath}`);
      }
    } catch {
      console.warn(`      ⚠️  Required file unreadable: ${filePath}`);
    }
  }
  
  return files;
}

/**
 * Generate directory tree for codebase
 * 
 * Creates a text representation of the directory structure
 * to help Plan make correct path decisions.
 * 
 * @param fileSystem - FileSystemPort
 * @param maxDepth - Maximum depth to traverse (default: 4)
 * @returns Formatted directory tree string
 */
export async function generateDirectoryTree(
  fileSystem: any,
  maxDepth: number = 4
): Promise<string | undefined> {
  const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 
    '.cache', 'coverage', '.turbo', '.vercel', '__pycache__',
    'venv', '.venv', 'target', '.idea', '.vscode'
  ]);
  
  const IGNORE_FILES = new Set([
    '.DS_Store', 'Thumbs.db', '.env', '.env.local',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ]);
  
  const lines: string[] = [];
  
  async function traverse(dirPath: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    
    try {
      const entries = await fileSystem.readDirectory(dirPath);
      if (!entries || entries.length === 0) return;
      
      // Sort: directories first, then files
      const sorted = entries
        .filter((e: any) => e?.name && !IGNORE_DIRS.has(e.name) && !IGNORE_FILES.has(e.name))
        .sort((a: any, b: any) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
      
      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const isLast = i === sorted.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        
        if (entry.isDirectory) {
          lines.push(`${prefix}${connector}${entry.name}/`);
          const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
          await traverse(childPath, prefix + childPrefix, depth + 1);
        } else {
          lines.push(`${prefix}${connector}${entry.name}`);
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  
  // Start from codebase root
  lines.push('codebase/');
  await traverse('codebase', '', 1);
  
  if (lines.length <= 1) {
    return undefined;
  }
  
  return lines.join('\n');
}
