import * as fs from 'fs';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../../../core/types/user';
import { readBranchBaseFromConfig } from '../../../../../../../../core/utils/branchUtils';
import { logger } from '../../../../../../../../utils/logger';
import { GitBootstrapSSOT } from '../BaseGitSetupOperation';
import { GitOperationError } from '../../../errors';
import { GitHelper } from '../../../helper/GitHelper';
import { WorktreeService } from '../../../worktree';
import { FeatureCodebaseBackup } from '../../../worktree/FeatureCodebaseBackup';

interface EnsureGitRepositoryInput {
  workspaceResolver: WorkspaceResolver;
  gitBootstrap: GitBootstrapSSOT;
  projectId: string;
  userContext: UserContext;
  featureName?: string;
  operationName: string;
  worktreeService?: WorktreeService;
  featureBackup?: FeatureCodebaseBackup;
}

interface EnsureGitRepositoryResult {
  git: SimpleGit;
  codebasePath: string;
}

export async function ensureGitRepository(input: EnsureGitRepositoryInput): Promise<EnsureGitRepositoryResult> {
  const {
    workspaceResolver,
    gitBootstrap,
    projectId,
    userContext,
    featureName,
    operationName,
    worktreeService,
    featureBackup,
  } = input;

  const codebasePath = workspaceResolver.getCodebasePath(userContext, projectId, featureName);
  await GitHelper.ensureSafeDirectory(codebasePath);

  let git = GitHelper.getGitInstanceSafe(codebasePath);

  if (!git && featureName && worktreeService && featureBackup) {
    const backups = await featureBackup.backup(projectId, [featureName], userContext);
    try {
      await worktreeService.createWorktree(projectId, featureName, userContext);
      const backupPath = backups.get(featureName);
      if (backupPath && fs.existsSync(backupPath)) {
        await featureBackup.restoreToWorktree(backupPath, codebasePath);
      }
    } finally {
      await featureBackup.cleanup(backups);
    }

    await GitHelper.ensureSafeDirectory(codebasePath);
    git = GitHelper.getGitInstanceSafe(codebasePath);
  }

  if (!git) {
    const mainCodebasePath = workspaceResolver.getCodebasePath(userContext, projectId);
    const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
    const baseBranch = readBranchBaseFromConfig(projectPath);

    const bootstrap = await gitBootstrap.ensureLocalGitReady({
      projectId,
      codebasePath: mainCodebasePath,
      baseBranch,
      userContext,
    });

    if (!bootstrap.ready) {
      throw new GitOperationError(
        `Failed to prepare local repository (${bootstrap.reason ?? 'unknown'})`,
        'config',
        { retryable: false }
      );
    }

    if (featureName && worktreeService) {
      await worktreeService.createWorktree(projectId, featureName, userContext);
    }

    await GitHelper.ensureSafeDirectory(codebasePath);
    git = GitHelper.getGitInstanceSafe(codebasePath);

    logger.info(
      'gitBootstrapRecovered',
      {
        component: operationName,
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        projectId,
      },
      {
        featureName,
        codebasePath,
        via: 'remote-user-op',
      }
    );
  }

  if (!git) {
    throw new GitOperationError('Local repository is not ready after bootstrap', 'config', {
      retryable: false,
    });
  }

  return { git, codebasePath };
}
