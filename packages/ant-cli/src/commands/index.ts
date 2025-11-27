/**
 * Index Command
 * 
 * Manually index codebase into Vector DB.
 * 
 * Usage:
 *   ant index <project>
 *   ant index my-project --incremental
 */

import { CodebaseIndexer } from '../core/codebase/CodebaseIndexer';
import { SimpleGitAdapter } from '../infrastructure/adapters/SimpleGitAdapter';
import { ChromaMemoryAdapter } from '../periphery/adapters/memory/ChromaMemoryAdapter';
import { ChunkAdapter } from '../infrastructure/adapters/ChunkAdapter';
import { WorkspaceResolver } from '../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../core/types/user';
import * as path from 'path';
import * as fs from 'fs';

export async function indexCommand(
  project: string,
  options: {
    incremental?: boolean;  // Only index changed files (future)
  } = {}
) {
  console.log(`\n📇 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📇 Indexing codebase: ${project}`);
  console.log(`📇 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    // 1. Resolve workspace path
    const workspaceResolver = new WorkspaceResolver();
    const userContext: UserContext = {
      userId: 'local',
      organizationId: 'local',
      workspacePath: ''
    };

    const projectPath = workspaceResolver.getProjectPath(userContext, project);
    
    // 2. Read config
    const configPath = path.join(projectPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Project config not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // 3. Determine codebase path
    let codebasePath: string;
    if (config.repoType === 'local') {
      if (!config.localPath) {
        throw new Error('Local path not configured');
      }
      codebasePath = config.localPath.startsWith('~')
        ? config.localPath.replace('~', process.env.HOME || '')
        : path.isAbsolute(config.localPath)
        ? config.localPath
        : path.resolve(process.cwd(), config.localPath);
    } else {
      codebasePath = path.join(projectPath, 'codebase');
    }

    console.log(`📂 Codebase path: ${codebasePath}\n`);

    // 4. Check Git
    const gitDir = path.join(codebasePath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error('Git repository not initialized. Please clone or initialize first.');
    }

    // 5. Initialize adapters
    const git = new SimpleGitAdapter(codebasePath);
    const vectorDB = new ChromaMemoryAdapter();
    const chunk = new ChunkAdapter();

    // 6. Run indexer
    const indexer = new CodebaseIndexer();
    const stats = await indexer.index(
      { git, vectorDB, chunk },
      {
        project,
        workingDir: codebasePath
      }
    );

    console.log(`\n✅ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ Indexing Complete!`);
    console.log(`✅ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Files indexed: ${stats.filesIndexed}`);
    console.log(`   Chunks created: ${stats.chunksCreated}`);
    console.log(`   Est. tokens: ${stats.estimatedTokens.toLocaleString()}`);
    console.log(`   Duration: ${(stats.duration / 1000).toFixed(1)}s\n`);

    if (options.incremental) {
      console.log('ℹ️  Incremental indexing not yet implemented (will index all files)\n');
    }

  } catch (error) {
    console.error(`\n❌ Indexing failed:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

