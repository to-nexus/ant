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
import { AdapterFactory } from '../infrastructure/adapters/AdapterFactory';
import { UnifiedWorkspaceResolver, WorkspacePathResolver } from '../core/config/WorkspacePathResolver';
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
    const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
    const workspaceResolver = new UnifiedWorkspaceResolver(workspacesPath);
    const userContext: UserContext = {
      userId: 'local',
      organizationId: 'local',
    };

    const projectPath = workspaceResolver.getProjectPath(userContext, project);
    
    // 2. Read config
    const configPath = path.join(projectPath, 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Project config not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // 3. Determine codebase path (centralized resolution)
    const codebasePath = workspaceResolver.getCodebasePath(userContext, project);

    console.log(`📂 Codebase path: ${codebasePath}\n`);

    // 4. Check Git
    const gitDir = path.join(codebasePath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error('Git repository not initialized. Please clone or initialize first.');
    }

    // 5. Initialize adapters using factory (hexagonal architecture)
    const git = AdapterFactory.createGitAdapter(codebasePath, project);
    const vectorDB = AdapterFactory.createMemoryAdapter();
    const chunk = AdapterFactory.createChunkAdapter();

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
