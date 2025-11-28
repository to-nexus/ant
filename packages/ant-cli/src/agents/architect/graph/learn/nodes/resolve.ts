/**
 * Learn Resolve Node
 * 
 * LLM이 분해한 명령을 실행:
 * - index_branch: 특정 브랜치 인덱싱
 * - index_codebase: 전체 코드베이스 인덱싱
 * - learn_files: 특정 파일들 학습
 * - learn_text: 텍스트 학습
 */

import * as path from "path";
import { LearnGraphState } from "../state";

export async function resolve(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
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
  const branchName = command.branch || 'current';

  // Show indexing status for codebase
  await chatAPI.showChatStatus('indexing', { 
    message: `Indexing codebase (${branchName})...` 
  });
  
  const git = state.deps?.git;
  if (!git) {
    throw new Error("GitPort is required for indexing operations");
  }

  // Import CodebaseIndexer
  const { CodebaseIndexer } = await import('../../../../../core/codebase/CodebaseIndexer');
  const { ChromaMemoryAdapter } = await import('../../../../../periphery/adapters/memory/ChromaMemoryAdapter');
  const { ChunkAdapter } = await import('../../../../../periphery/adapters/chunk/ChunkingAdapter');

  const vectorDB = new ChromaMemoryAdapter();
  const chunk = new ChunkAdapter();

  // Run indexer
  const indexer = new CodebaseIndexer();
  
  // Check if this is first-time indexing by checking if any files exist for this project
  const hasExistingIndex = await vectorDB.query(
    'check existing index',
    state.context.project,
    { k: 1, where: { type: 'codebase' } }
  );
  
  const forceFullIndexing = hasExistingIndex.length === 0;
  
  if (forceFullIndexing) {
    console.log('   🆕 First-time indexing → Forcing full index');
  }
  
  const stats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: state.context.project,
      workingDir: state.context.workingDir,
      branch: command.branch,
      incremental: !forceFullIndexing && command.mode !== 'full'  // Force full if first time
    }
  );

  // Show completion with detailed stats
  console.log(`✅ Indexed ${stats.filesIndexed} files (${stats.chunksCreated} chunks, ~${stats.estimatedTokens} tokens)`);
  
  // Send indexed completion status to UI
  await chatAPI.showChatStatus('indexed', {
    filesIndexed: stats.filesIndexed,
    chunks: stats.chunksCreated,
    tokens: stats.estimatedTokens,
    duration: stats.duration
  });

  return {
    targets: [`branch:${branchName}`],
    texts: [
      `Indexed codebase from branch: ${branchName}`,
      `Files: ${stats.filesIndexed}`,
      `Chunks: ${stats.chunksCreated}`,
      `Tokens: ~${stats.estimatedTokens}`,
      `Duration: ${(stats.duration / 1000).toFixed(1)}s`
    ]
  };
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

  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  const base = state.context.workingDir;
  const targets = command.files || [];
  const texts: string[] = [];

  // Show analyzing status for files
  await chatAPI.showChatStatus('analyzing', { 
    message: `Analyzing ${targets.length} file(s)...` 
  });

  if (targets.length) {
    for (const t of targets) {
      const abs = path.isAbsolute(t) ? t : path.join(base, t);
      const repoRoot = await gitPort.getRepoRoot();
      const relativePath = path.relative(repoRoot, abs);

      const exists = await gitPort.fileExists(relativePath);
      if (exists) {
        try {
          await chatAPI.addReadingFile(relativePath);
          const content = await gitPort.readFile(relativePath);
          if (content) {
            texts.push(content);
            await chatAPI.addReadComplete(relativePath);
          }
        } catch {
          // Might be a directory
          try {
            const entries = await gitPort.readDirectory(relativePath);
            for (const entry of entries) {
              if (!entry.isDirectory) {
                const filePath = path.join(relativePath, entry.name);
                await chatAPI.addReadingFile(filePath);
                const fileContent = await gitPort.readFile(filePath);
                if (fileContent) {
                  texts.push(fileContent);
                  await chatAPI.addReadComplete(filePath);
                }
              }
            }
          } catch {
            // Skip
          }
        }
      }
    }
  }

  if (!texts.length) {
    texts.push(state.spec);
  }

  // Show analyzed completion
  await chatAPI.showChatStatus('analyzed', {
    filesCount: texts.length,
    filesList: targets.slice(0, 5)  // First 5 files
  });

  return { targets, texts };
}

/**
 * 텍스트 학습 (기존 방식)
 */
async function executeTextLearn(
  state: LearnGraphState,
  command: { text?: string }
): Promise<Partial<LearnGraphState>> {
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  const text = command.text || state.spec;

  // Show storing status for text
  await chatAPI.showChatStatus('storing', { 
    message: 'Storing lesson...' 
  });

  // Note: 'stored' will be shown by store node
  return {
    targets: ['raw-text'],
    texts: [text]
  };
}
