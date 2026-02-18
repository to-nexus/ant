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
import { RETRIEVAL_CONFIG } from "../../config/retrievalConfig";

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
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    console.warn(`   ⚠️  FileSystemPort not available, skipping RAG`);
    return null;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EXCLUSIVE TASK FAST PATH: Load ALL codebase files directly
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Exclusive tasks (integration, verification) need full codebase awareness.
  // RAG keyword search is insufficient — load everything to eliminate read_file loops.
  const isExclusiveTask = state.currentTask?.exclusive === true;
  if (isExclusiveTask) {
    console.log(`🔍 [RAG] Exclusive task detected → loading codebase files (core=content, reference=path-only)`);
    
    const language = state.detectionReport?.profile?.language;
    const allCodebaseFiles = await loadAllCodebaseFiles(fileSystem, state.currentTask?.description, language);
    
    // Also load error files if this is a retry
    const errorFiles = taskKeywords.errorFiles.length > 0
      ? await loadErrorFiles(taskKeywords.errorFiles, state, git, fileSystem)
      : [];
    
    // Merge: errorFiles override codebase files (more recent content)
    const allFiles = [...allCodebaseFiles, ...errorFiles];
    const uniqueFiles = Array.from(
      new Map(allFiles.map(f => [f.path, f])).values()
    );
    
    console.log(`   ✅ Exclusive context: ${uniqueFiles.length} files (${allCodebaseFiles.length} codebase + ${errorFiles.length} error, ${allFiles.length - uniqueFiles.length} dedup)`);
    uniqueFiles.forEach(f => console.log(`      📄 ${f.path}`));
    
    // Show in Chat UI
    try {
      const chatAPI = getChatAPIClient();
      const loadMergeIndex = await chatAPI.showChatStatus('loading', { filesCount: 0 });
      await chatAPI.showChatStatus('loaded', {
        filesCount: uniqueFiles.length,
        filesList: uniqueFiles.map(f => f.path),
        content: `Loaded: ${uniqueFiles.length} codebase files (exclusive task)`,
        _mergeIndex: loadMergeIndex
      });
    } catch {
      // Non-critical
    }
    
    const projectCodeContext: ProjectCodeContext = {
      filePaths: uniqueFiles.map(f => f.path),
      files: uniqueFiles,
      stats: {
        filesLoaded: uniqueFiles.length,
        errorFilesCount: errorFiles.length,
        semanticCount: 0,
        deduplicatedCount: allFiles.length - uniqueFiles.length,
      },
      source: 'plan' as const
    };
    
    // Git diff
    if (git) {
      const gitDiffResult = await generateGitDiffSummary(git, state.context.workingDir, projectCodeContext.filePaths);
      projectCodeContext.gitDiff = gitDiffResult ?? undefined;
    }
    
    // Directory tree
    if (directoryTree) {
      projectCodeContext.directoryTree = directoryTree;
    } else {
      try {
        projectCodeContext.directoryTree = await generateDirectoryTree(fileSystem, 4);
      } catch {
        // Non-critical
      }
    }
    
    return { context: projectCodeContext, lessons: [] };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NORMAL TASK PATH: Three-tier RAG search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const hasStackTrace = taskKeywords.errorFiles.length > 0;
  const hasKeywords = taskKeywords.keywords.length > 0;
  const hasRequiredFiles = taskKeywords.requiredFiles.length > 0;
  
  // If nothing to search for, return null (caller will create empty context)
  if (!hasStackTrace && !hasKeywords && !hasRequiredFiles) {
    console.log(`   ℹ️  No required files, stack trace, or keywords - skipping RAG`);
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
 * Load ALL codebase files for exclusive tasks (integration, verification).
 * 
 * Uses Option B strategy: Core files get FULL CONTENT, reference files get PATH ONLY.
 * Core files are identified by language-aware patterns and optional task keywords.
 * Reference files are still listed (LLM can read_file if needed), but their content
 * is omitted from the prompt to reduce token usage by ~50%.
 * 
 * Safeguards:
 * - File count capped at EXCLUSIVE_MAX_FILES
 * - Large core files truncated to EXCLUSIVE_MAX_FILE_LINES
 * - Binary files skipped
 * 
 * @param fileSystem - FileSystemPort for file access
 * @param taskDescription - Current task description for keyword-based core file detection
 * @returns Array of loaded files (core files with content, reference files without)
 */
async function loadAllCodebaseFiles(
  fileSystem: FileSystemPort,
  taskDescription?: string,
  language?: string
): Promise<LoadedFile[]> {
  const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.zip', '.tar', '.gz', '.br', '.zst',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.exe', '.dll', '.so', '.dylib', '.wasm',
    '.sqlite', '.db',
  ]);

  const files: LoadedFile[] = [];

  try {
    const allPaths = await fileSystem.listFiles('codebase', [
      'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
      'coverage', '__pycache__', 'venv', '.venv', 'target',
      '*.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
    ]);

    const textPaths = allPaths.filter(p => {
      const ext = path.extname(p).toLowerCase();
      return !BINARY_EXTENSIONS.has(ext);
    });

    const cappedPaths = textPaths.slice(0, RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILES);
    if (textPaths.length > RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILES) {
      console.log(`   ⚠️  Capped codebase files: ${textPaths.length} → ${RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILES}`);
    }

    const corePatterns = getCorePatterns(language);
    const taskKeywords = extractTaskKeywords(taskDescription);

    let coreCount = 0;
    let refCount = 0;

    for (const filePath of cappedPaths) {
      const isCore = coreCount < RETRIEVAL_CONFIG.EXCLUSIVE_MAX_CORE_FILES &&
        isCoreFile(filePath, corePatterns, taskKeywords);

      if (isCore) {
        try {
          const content = await fileSystem.readFile(filePath);
          if (!content) continue;

          const lines = content.split('\n');
          const truncated = lines.length > RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILE_LINES
            ? lines.slice(0, RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILE_LINES).join('\n') +
              `\n\n// ... truncated (${lines.length - RETRIEVAL_CONFIG.EXCLUSIVE_MAX_FILE_LINES} more lines)`
            : content;

          files.push({ path: filePath, content: truncated, source: 'local' });
          coreCount++;
        } catch {
          // Skip unreadable files
        }
      } else {
        files.push({ path: filePath, content: '', source: 'local' });
        refCount++;
      }
    }

    console.log(`   📦 [Exclusive] ${files.length} files: ${coreCount} core (full content) + ${refCount} reference (path only). ${allPaths.length - textPaths.length} binary skipped`);
  } catch (err) {
    console.warn(`   ⚠️  Failed to list codebase files:`, err instanceof Error ? err.message : err);
  }

  return files;
}

/**
 * Build core file patterns by combining universal patterns with language-specific ones.
 * Falls back to TypeScript patterns when language is unknown (widest coverage).
 */
function getCorePatterns(language?: string): string[] {
  const universal = [...RETRIEVAL_CONFIG.EXCLUSIVE_CORE_PATTERNS_UNIVERSAL];
  const langMap = RETRIEVAL_CONFIG.EXCLUSIVE_CORE_PATTERNS_BY_LANGUAGE;
  const langKey = language
    ? Object.keys(langMap).find(k => language.toLowerCase().includes(k))
    : undefined;
  const langSpecific = langKey ? [...langMap[langKey]] : [...(langMap['typescript'] || [])];
  return [...universal, ...langSpecific];
}

/**
 * Check if a file path matches core file patterns or task keywords.
 */
function isCoreFile(
  filePath: string,
  patterns: readonly string[],
  taskKeywords: string[]
): boolean {
  const lower = filePath.toLowerCase();
  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) return true;
  }
  for (const kw of taskKeywords) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * Extract meaningful keywords from task description for core file matching.
 * Returns lowercase path-friendly fragments (e.g., "auth", "handler", "profile").
 */
function extractTaskKeywords(description?: string): string[] {
  if (!description) return [];
  const words = description.toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && w.length <= 30);
  return [...new Set(words)];
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
