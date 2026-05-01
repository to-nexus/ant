/**
 * Semantic Search for Context Files
 *
 * Clear 3-tier separation (NO fallback concept):
 * 1. Retrieved: Vector DB search results
 * 2. Explored: Git uncommitted changes (from retrieved files)
 * 3. Grepped: Local file search (NOT in Vector DB)
 */

import path from "path";
import { GitPort } from "../../../../../../../core/ports";
import { ArchitectGraphState } from "../../../state";
import { getChatAPIClient } from "../../../../../../../core/adapters/ChatAPIClient";
import { RETRIEVAL_CONFIG } from "../../../config/retrievalConfig";
import type { LoadedFile } from "./errorFiles";

// ✅ Lesson type from CodebaseRetriever
export interface LessonResult {
  content: string;
  score: number;
  relatedFiles: string[];
  tags: string[];
  timestamp: string;
  directive?: string;
}

// ✅ Extended return type to include lessons
export interface SemanticSearchResult {
  files: LoadedFile[];
  lessons: LessonResult[];
}

export async function loadSemanticFiles(
  keywords: string[],
  state: ArchitectGraphState,
  retriever: any,
  vectorDB: any,
  git: GitPort,
  extractFilesFromCode: (code: string) => Array<{path: string; content: string}>,
  excludePaths: string[] = [],
  isIntegration: boolean = false,
  overrideTotalMax?: number
): Promise<SemanticSearchResult> {
  const chatAPI = getChatAPIClient();

  if (keywords.length === 0) return { files: [], lessons: [] };

  const totalMax = overrideTotalMax ?? (isIntegration ? RETRIEVAL_CONFIG.INTEGRATION_TOTAL_MAX : RETRIEVAL_CONFIG.TOTAL_MAX);
  const semanticQuota = Math.max(0, totalMax - excludePaths.length);

  if (semanticQuota === 0) {
    console.log(`   ⚠️  Semantic search skipped: quota exhausted (${excludePaths.length}/${totalMax} files already loaded)`);
    return { files: [], lessons: [] };
  }

  console.log(`   🔍 Semantic search: ${keywords.length} keywords → quota ${semanticQuota} NEW files (${excludePaths.length} already loaded will be excluded)${isIntegration ? ' [integration mode]' : ''}...`);
  console.log(`   📊 Target: ${excludePaths.length} pre-loaded + ${semanticQuota} semantic = ${excludePaths.length + semanticQuota} total files`);

  const searchQuery = keywords.join(' ');

  const retrievingIndex = await chatAPI.showChatStatus('retrieving', {
    query: searchQuery
  });

  let vectorDbPaths: string[] = [];
  let greppedPaths: string[] = [];
  let allVectorFiles: string[] = [];  // ✅ Track all results before filtering
  let retrievedLessons: LessonResult[] = [];  // ✅ Capture lessons from Vector DB

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
        mode: state.resolvedAction?.mode || 'refactor'
      }
    );

    const files = extractFilesFromCode(searchResult.code);
    allVectorFiles = files.map(f => f.path);

    // ✅ Capture lessons from retriever (will be propagated to state)
    if (searchResult.lessons && Array.isArray(searchResult.lessons)) {
      retrievedLessons = searchResult.lessons;
    }

    // ✅ CRITICAL: Remove duplicates from Vector DB results (same file from multiple keywords)
    const uniqueVectorFiles = Array.from(new Set(allVectorFiles));
    const internalDuplicates = allVectorFiles.length - uniqueVectorFiles.length;
    const duplicatesCount = uniqueVectorFiles.filter(p => excludePaths.includes(p)).length;

    // ✅ Filter out already loaded files and apply quota
    vectorDbPaths = uniqueVectorFiles.filter(p => !excludePaths.includes(p)).slice(0, semanticQuota);

    if (internalDuplicates > 0) {
      console.log(`   ✅ Vector DB: ${vectorDbPaths.length} files (${internalDuplicates} internal duplicates + ${duplicatesCount} already loaded duplicates removed, requested ${requestCount} files)`);
    } else {
      console.log(`   ✅ Vector DB: ${vectorDbPaths.length} files (${duplicatesCount} already loaded duplicates excluded, requested ${requestCount} files)`);
    }
  } catch (e: any) {
    console.warn(`   ⚠️  Vector DB failed: ${e.message}`);
  }

  // Step 2: Git changes + added (all uncommitted files)
  // ✅ REDESIGNED: Include ALL git changes (modified + created + deleted + untracked)
  // - Files in Vector DB: override with latest version
  // - Files NOT in Vector DB: new files from previous tasks
  let localFilePaths: string[] = [];

  try {
    const hasChanges = await git.hasChanges();
    if (hasChanges) {
      const changedFiles = await git.getChangedFiles();

      // Include all changed files (no Vector DB filter)
      const gitAllChanges = changedFiles.filter(f =>
        !excludePaths.includes(f) &&
        !vectorDbPaths.includes(f)  // Exclude already found in Vector DB (avoid duplicates)
      );

      const remainingQuota = semanticQuota - vectorDbPaths.length;
      const filesToAdd = gitAllChanges.slice(0, remainingQuota);

      localFilePaths.push(...filesToAdd);

      if (filesToAdd.length > 0) {
        console.log(`   📝 Git changes + added: ${filesToAdd.length} files (new/modified from previous tasks)`);
        filesToAdd.slice(0, 5).forEach(p => console.log(`      - ${p}`));
        if (filesToAdd.length > 5) {
          console.log(`      ... and ${filesToAdd.length - 5} more`);
        }
      }
    }
  } catch (e: any) {
    console.warn(`   ⚠️  Git changes check failed: ${e.message}`);
  }

  // Step 3: Pure local keyword search (fallback for non-git or remaining quota)
  // ✅ REDESIGNED: Only runs if quota remains after git search
  let remainingQuota = semanticQuota - vectorDbPaths.length - localFilePaths.length;

  if (remainingQuota > 0 && keywords.length > 0) {
    console.log(`   🔍 Local keyword search (fallback): ${remainingQuota} slots remaining...`);

    try {
      const { KeywordSearchStrategy } = await import('../../../../../../../core/codebase/strategies/KeywordSearchStrategy');
      const keywordStrategy = new KeywordSearchStrategy();

      const directive = keywords.join(' ');

      const fileSystem = state.deps?.fileSystem;
      if (!fileSystem) {
        console.warn(`      ⚠️  FileSystemPort not available, skipping keyword search`);
      } else {
        const keywordResults = await keywordStrategy.search(
          directive,
          state.context.workingDir,
          {
            maxFiles: remainingQuota,
            exclude: [
              'node_modules',
              '.git',
              'dist',
              'build',
              '.next',
              'coverage',
              '.turbo'
            ]
          },
          git,
          fileSystem
        );

        const keywordSearchPaths = keywordResults
          .map(r => r.path)
          .filter(p =>
            !excludePaths.includes(p) &&
            !vectorDbPaths.includes(p) &&
            !localFilePaths.includes(p)
          );

        if (keywordSearchPaths.length > 0) {
          console.log(`      ✅ Found ${keywordSearchPaths.length} files by keyword matching`);
          keywordSearchPaths.forEach(p => console.log(`         - ${p}`));
          localFilePaths.push(...keywordSearchPaths);
        }
      }
    } catch (e: any) {
      console.warn(`      ⚠️  Keyword search failed: ${e.message}`);
    }
  }

  // Step 4: Load all files from local Git and categorize
  const totalFilesToLoad = vectorDbPaths.length + localFilePaths.length;
  console.log(`   📄 Loading ${totalFilesToLoad} files from local Git...`);

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    console.warn(`   ⚠️  FileSystemPort not available, skipping file loading`);
    return { files: [], lessons: retrievedLessons };
  }

  const vectorDbFiles: LoadedFile[] = [];
  const localFiles: LoadedFile[] = [];
  const allPaths = [...vectorDbPaths, ...localFilePaths];

  // FileSystemPort expects paths relative to workspace root, not absolute paths.
  // state.context.workingDir is absolute (e.g., /…/ant-prediction/codebase),
  // so we must convert to workspace-relative (e.g., codebase/.eslintignore).
  const rootPath = fileSystem.getRootPath();

  for (const filePath of allPaths) {
    try {
      const fullPath = path.join(state.context.workingDir, filePath);
      const relativePath = path.relative(rootPath, fullPath);
      const content = await fileSystem.readFile(relativePath);

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

  // Display: 1. Retrieved (Vector DB results ONLY) - resolve the 'retrieving' spinner
  if (vectorDbFiles.length > 0) {
    console.log(`\n📤 [semantic] Sending 'retrieved' status (${vectorDbFiles.length} files from Vector DB)...`);
    try {
      await chatAPI.showChatStatus('retrieved', {
        filesCount: vectorDbFiles.length,
        filesList: vectorDbFiles.map(f => f.path),
        content: `Retrieved: ${vectorDbFiles.length} files from Vector DB`,
        _mergeIndex: retrievingIndex
      });
      console.log(`   ✅ 'retrieved' status sent successfully\n`);
    } catch (error: any) {
      console.error(`   ❌ 'retrieved' status FAILED:`, error.message);
    }
  } else {
    // 0 Vector DB files: remove the 'retrieving' UI element entirely
    console.log(`   ℹ️  Retrieved: 0 files from Vector DB — removing retrieving UI`);
    if (retrievingIndex !== undefined) {
      await chatAPI.removeChatStatus(retrievingIndex, 'retrieving');
    }
  }

  // Display: 2. Explored (Git changes in retrieved files) - only if > 0 files
  if (exploredFiles.length > 0) {
    console.log(`\n📤 [semantic] Sending 'exploring' → 'explored' status (${exploredFiles.length} files)...`);
    try {
      const mergeIndex = await chatAPI.showChatStatus('exploring', {
        filesCount: 0,
        totalFiles: 0
      });

      await chatAPI.showChatStatus('explored', {
        filesCount: exploredFiles.length,
        filesList: exploredFiles,
        content: `Explored: ${exploredFiles.length} files with uncommitted changes`,
        _mergeIndex: mergeIndex
      });
      console.log(`   'exploring' → 'explored' status sent successfully\n`);
    } catch (error: any) {
      console.error(`   ❌ 'exploring/explored' status FAILED:`, error.message);
    }
  } else {
    console.log(`   ℹ️  Explored: 0 files with uncommitted changes (skipping UI)`);
  }

  // Display: 3. Grepped (Local files - NOT in Vector DB) - only if > 0 files
  if (localFiles.length > 0) {
    console.log(`\n📤 [semantic] Sending 'grepping' → 'grepped' status (${localFiles.length} files)...`);
    try {
      const mergeIndex = await chatAPI.showChatStatus('grepping', {
        filesCount: 0,
        totalFiles: 0
      });

      await chatAPI.showChatStatus('grepped', {
        filesCount: localFiles.length,
        keywords: keywords,
        filesList: localFiles.map(f => f.path),
        content: `Grepped: ${localFiles.length} local files`,
        _mergeIndex: mergeIndex
      });
      console.log(`   'grepping' → 'grepped' status sent successfully\n`);
    } catch (error: any) {
      console.error(`   ❌ 'grepping/grepped' status FAILED:`, error.message);
    }
  } else {
    console.log(`   ℹ️  Grepped: 0 local files (skipping UI)`);
  }

  console.log(`   Semantic loader: ${semanticFiles.length} files loaded (quota was ${semanticQuota})\n`);

  // ✅ Return both files and lessons
  return {
    files: semanticFiles,
    lessons: retrievedLessons
  };
}
