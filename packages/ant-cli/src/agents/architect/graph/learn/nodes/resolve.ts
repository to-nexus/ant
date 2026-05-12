/**
 * Learn Process Node
 * 
 * LLM이 분해한 명령을 실행:
 * - index_branch: 특정 브랜치 인덱싱
 * - index_codebase: 전체 코드베이스 인덱싱
 * - learn_files: 특정 파일들 학습
 * - learn_text: 텍스트 학습
 *
 * Renamed from "resolve" to "process" to avoid collision with common createResolveNode.
 */

import * as path from "path";
import { LearnGraphState } from "../state";
import { isVectorDbEnabled } from "../../../../../core/config/vectorDbCapability";

export async function processCommand(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const command = state.command;
  if (!command) {
    throw new Error("No command provided from decompose node");
  }

  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();

  switch (command.action) {
    case 'index_branch':
    case 'index_codebase':
      return await executeIndexing(state, command);

    case 'learn_files':
      return await executeFileLearn(state, command);

    case 'learn_text':
      return await executeTextLearn(state, command);

    default:
      throw new Error(`Unknown action: ${(command as any).action}`);
  }
}

/**
 * 브랜치/코드베이스 인덱싱
 */
async function executeIndexing(
  state: LearnGraphState,
  command: { action: string; branch?: string; mode?: string }
): Promise<Partial<LearnGraphState>> {
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();

  // ✅ Capability gate (SSOT: core/config/vectorDbCapability.ts).
  // Defense-in-depth — orchestrator.ts already short-circuits the learn job
  // upstream. This second gate guarantees `indexer.index()` (git walk +
  // chunking — the only meaningful time cost on this path) is never reached
  // when vector DB is disabled, even if a non-orchestrator caller (test,
  // future entry point) ends up here.
  if (!isVectorDbEnabled()) {
    await chatAPI.showChatStatus('indexed', {
      filesIndexed: 0,
      chunks: 0,
      tokens: 0,
      duration: 0,
      error: "Vector DB is disabled (ANT_VECTOR_DB_ENABLED=false). Set the env var to true and start ChromaDB to enable indexing.",
    });
    return {
      targets: [],
      texts: ["Vector DB disabled — indexing skipped."],
    };
  }

  const git = state.deps?.git;
  if (!git) {
    // ✅ Git is required for codebase indexing
    // Without Git, we cannot track commits, branches, or manage versioning
    const errorMsg = "Git repository is required for codebase indexing. This ensures proper version tracking for collaborative Vector DB.";
    
    await chatAPI.showChatStatus('indexed', {
      filesIndexed: 0,
      chunks: 0,
      tokens: 0,
      duration: 0,
      error: errorMsg
    });
    
    throw new Error(errorMsg);
  }

  let indexingIndex: string | undefined;
  try {
    // ✅ Get repo and branch info for better UI display
    const repoName = await git.getRepoName();
    const currentBranch = command.branch || await git.getCurrentBranch();
    const currentCommit = await git.getCurrentCommit();
    const isHead = !command.branch;  // If no branch specified, we're on HEAD
    
    // ✅ Show enhanced indexing status with repo and branch info
    const branchDisplay = isHead 
      ? `${currentBranch} (HEAD)`
      : currentBranch;
    
    indexingIndex = await chatAPI.showChatStatus('indexing', { 
      message: `${repoName} • ${branchDisplay}`,
      detail: `Commit: ${currentCommit.substring(0, 8)}`
    });
    
    console.log(`   Commit: ${currentCommit.substring(0, 8)}`);

    // Import CodebaseIndexer
    const { CodebaseIndexer } = await import('../../../../../core/codebase/CodebaseIndexer');

    // ✅ Past the capability gate, deps.memory + deps.chunk are guaranteed
    // to be the real implementations wired by orchestrator.ts. Missing deps
    // here means the caller forgot to wire them — fail loudly, do NOT fall
    // back to a NoOp adapter (NoOp on this path would silently complete a
    // chunking pipeline whose store output is discarded).
    const vectorDB = state.deps?.memory;
    const chunk = state.deps?.chunk;
    if (!vectorDB || !chunk) {
      throw new Error(
        "MemoryPort and ChunkPort are required for codebase indexing. " +
          "Caller must wire `deps.memory` and `deps.chunk` (DI bug)."
      );
    }

  // Run indexer
  const indexer = new CodebaseIndexer();
  
  // ✅ Check for index completion marker (not individual chunks)
  // This ensures we only consider fully completed indexing sessions
  const completionMarkers = await vectorDB.query(
    'check index completion marker',
    state.context.project,
    { 
      k: 1,
      where: { 
        $and: [
          { type: 'index_completion' },  // ✅ Check for completion marker
          { branch: currentBranch }
        ]
      } 
    }
  );
  
  let forceFullIndexing = false;
  
  if (completionMarkers.length === 0) {
    // No completion marker - need full index
    forceFullIndexing = true;
    console.log(`   🆕 No index completion marker found → Forcing full index`);
  } else {
    // Check if indexed commit matches current commit
    const indexedCommit = completionMarkers[0].metadata?.commitHash;
    
    if (!indexedCommit) {
      // Marker without commit hash (shouldn't happen)
      forceFullIndexing = true;
      console.log(`   ⚠️  Index marker missing commit hash → Forcing full re-index`);
    } else if (indexedCommit !== currentCommit) {
      // Commit has changed - incremental update needed
      forceFullIndexing = false;
      console.log(`   📊 Index exists (commit ${indexedCommit.substring(0, 8)}) → Incremental indexing`);
    } else {
      // Same commit - already indexed
      forceFullIndexing = false;
      console.log(`   ✅ Already indexed at current commit (${currentCommit.substring(0, 8)})`);
      
      // Check if incremental would find changes
      // If no git changes, skip indexing entirely
      const hasGitChanges = await git.hasChanges();
      if (!hasGitChanges) {
        console.log(`   ℹ️  No uncommitted changes detected, skipping indexing`);
        
        await chatAPI.showChatStatus('indexed', {
          filesIndexed: 0,
          chunks: 0,
          tokens: 0,
          duration: 0,
          _mergeIndex: indexingIndex
        });
        
        return {
          targets: [`${repoName}/${currentBranch}`],
          texts: [
            `Repo: ${repoName}`,
            `Branch: ${branchDisplay}`,
            `Commit: ${currentCommit.substring(0, 8)}`,
            `Status: Already indexed (no changes)`
          ]
        };
      }
    }
  }
  
  const stats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: state.context.project,
      workingDir: state.context.workingDir,
      branch: command.branch,
      incremental: !forceFullIndexing && command.mode !== 'full'  // Force full if first time OR mode is 'full'
    }
  );

  // Show completion with detailed stats
  console.log(`✅ Indexed ${stats.filesIndexed} files (${stats.chunksCreated} chunks, ~${stats.estimatedTokens} tokens)`);
  
  // Send indexed completion status to UI
  await chatAPI.showChatStatus('indexed', {
    filesIndexed: stats.filesIndexed,
    chunks: stats.chunksCreated,
    tokens: stats.estimatedTokens,
    duration: stats.duration,
    _mergeIndex: indexingIndex
  });

    return {
      targets: [`${repoName}/${currentBranch}`],
      texts: [
        `Repo: ${repoName}`,
        `Branch: ${branchDisplay}`,
        `Commit: ${currentCommit.substring(0, 8)}`,
        `Files: ${stats.filesIndexed}`,
        `Chunks: ${stats.chunksCreated}`,
        `Tokens: ~${stats.estimatedTokens}`,
        `Duration: ${(stats.duration / 1000).toFixed(1)}s`
      ]
    };
  } catch (error: any) {
    // ✅ CRITICAL: Update chat status to failed before throwing
    // This merges "indexing" → "indexed" (failed state)
    console.error(`❌ Indexing failed:`, error);
    
    await chatAPI.showChatStatus('indexed', {
      filesIndexed: 0,
      chunks: 0,
      tokens: 0,
      duration: 0,
      error: error.message,
      _mergeIndex: indexingIndex
    });
    
    // Re-throw to trigger job failure handling
    throw error;
  }
}

/**
 * 특정 파일들 학습 (기존 방식)
 */
async function executeFileLearn(
  state: LearnGraphState,
  command: { files?: string[] }
): Promise<Partial<LearnGraphState>> {
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
  }

  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    throw new Error("FileSystemPort not provided for file operations");
  }

  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  const base = state.context.workingDir;
  const targets = command.files || [];
  const texts: string[] = [];
  const failedFiles: string[] = [];

  const analyzingIndex = await chatAPI.showChatStatus('analyzing', { 
    message: `Analyzing ${targets.length} file(s)...` 
  });
  
  try {
    // Show analyzing status for files
    if (targets.length) {
      for (const t of targets) {
        try {
          const abs = path.isAbsolute(t) ? t : path.join(base, t);
          const repoRoot = await gitPort.getRepoRoot();
          const relativePath = path.relative(repoRoot, abs);

          const exists = await fileSystem.fileExists(relativePath);
          if (!exists) {
            console.warn(`   ⚠️  File not found: ${relativePath}`);
            failedFiles.push(relativePath);
            continue;
          }

          let readingIdx: string | undefined;
          try {
            readingIdx = await chatAPI.addReadingFile(relativePath);
            const content = await fileSystem.readFile(relativePath);
            if (content) {
              texts.push(content);
              await chatAPI.addReadComplete(relativePath, readingIdx);
            } else {
              // ✅ CRITICAL: Complete reading status even when file is empty!
              await chatAPI.addReadComplete(relativePath, readingIdx, { error: 'File is empty' });
              failedFiles.push(relativePath);
            }
          } catch (readError) {
            // Might be a directory - complete the initial reading status first
            if (readingIdx !== undefined) {
              await chatAPI.addReadComplete(relativePath, readingIdx, { error: 'Is a directory' });
            }
            
            try {
              const entries = await fileSystem.readDirectory(relativePath);
              let dirFilesRead = 0;
              
              for (const entry of entries) {
                if (!entry.isDirectory) {
                  const filePath = path.join(relativePath, entry.name);
                  let fileReadingIdx: string | undefined;
                  try {
                    fileReadingIdx = await chatAPI.addReadingFile(filePath);
                    const fileContent = await fileSystem.readFile(filePath);
                    if (fileContent) {
                      texts.push(fileContent);
                      await chatAPI.addReadComplete(filePath, fileReadingIdx);
                      dirFilesRead++;
                    } else {
                      // ✅ CRITICAL: Complete reading status even when file is empty!
                      await chatAPI.addReadComplete(filePath, fileReadingIdx, { error: 'File is empty' });
                    }
                  } catch (fileError) {
                    console.warn(`   ⚠️  Failed to read file in directory: ${filePath}`);
                    // ✅ CRITICAL: Complete reading status even on error!
                    if (fileReadingIdx !== undefined) {
                      await chatAPI.addReadComplete(filePath, fileReadingIdx, { error: 'Read failed' });
                    }
                    failedFiles.push(filePath);
                  }
                }
              }
              
              if (dirFilesRead === 0) {
                failedFiles.push(relativePath);
              }
            } catch (dirError) {
              console.warn(`   ⚠️  Failed to read directory: ${relativePath}`, dirError);
              failedFiles.push(relativePath);
            }
          }
        } catch (fileError: any) {
          console.error(`   ❌ Failed to analyze: ${t}`, fileError);
          failedFiles.push(t);
        }
      }
    }

    if (!texts.length && !state.directive) {
      // ✅ No files read and no spec - this is a failure
      throw new Error(`Failed to analyze files: No content found. Failed files: ${failedFiles.join(', ')}`);
    }

    if (!texts.length && state.directive) {
      texts.push(state.directive);
    }

    // ✅ Show analyzed completion (success or partial success)
    await chatAPI.showChatStatus('analyzed', {
      filesCount: texts.length,
      filesList: targets.slice(0, 5),  // First 5 files
      failedCount: failedFiles.length,
      failedFiles: failedFiles.length > 0 ? failedFiles.slice(0, 3) : undefined,
      _mergeIndex: analyzingIndex
    });

    return { targets, texts };
    
  } catch (error: any) {
    // ✅ CRITICAL: Update status to analyzed (failed) before throwing
    console.error(`❌ File analysis failed:`, error);
    
    await chatAPI.showChatStatus('analyzed', {
      filesCount: 0,
      filesList: [],
      failedCount: targets.length,
      error: error.message,
      _mergeIndex: analyzingIndex
    });
    
    throw error;
  }
}

/**
 * 텍스트 학습 (기존 방식)
 */
async function executeTextLearn(
  state: LearnGraphState,
  command: { text?: string }
): Promise<Partial<LearnGraphState>> {
  const text = command.text || state.directive || '';

  // Note: 'storing' → 'stored' will be shown by store node
  return {
    targets: ['raw-text'],
    texts: [text]
  };
}
