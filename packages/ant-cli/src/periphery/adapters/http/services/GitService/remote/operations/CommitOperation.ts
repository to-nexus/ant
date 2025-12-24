import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../../core/types/user';
import { GitHelper } from '../../helper/GitHelper';

/**
 * CommitOperation
 * 
 * Handles committing changes to Git.
 */
export class CommitOperation {
  constructor(
    private readonly workspaceResolver: WorkspaceResolver
  ) {}

  async execute(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    const { codebasePath } = await this.loadProjectConfig(projectId, userContext);

    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    // Check if there are changes to commit
    const status = await git.status();
    
    if (status.files.length === 0) {
      console.log('[CommitOperation] No changes to commit');
      return { success: true };
    }

    // Stage all changes
    await git.add('.');
    
    // Commit with provided message or default
    const commitMessage = message || `Update: ${new Date().toISOString()}`;
    const result = await git.commit(commitMessage);
    
    console.log(`[CommitOperation] ✅ Committed: ${commitMessage}`);
    
    return {
      success: true,
      commitHash: result.commit
    };
  }

  private async loadProjectConfig(projectId: string, userContext: UserContext) {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

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

    return { config, codebasePath, projectPath };
  }
}

