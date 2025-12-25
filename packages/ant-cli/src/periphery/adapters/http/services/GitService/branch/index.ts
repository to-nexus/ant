import * as fs from 'fs';
import * as path from 'path';
import { SimpleGit } from 'simple-git';
import { WorkspaceResolver } from '../../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../../core/types/user';
import { GitHubAuthService } from '../../../../auth/GitHubAuthService';
import { GitHelper } from '../helper/GitHelper';

/**
 * BranchService
 * 
 * Handles Git branch operations including creation, switching, and stash management
 */
export class BranchService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;
  
  constructor(workspaceResolver: WorkspaceResolver, githubAuthService?: GitHubAuthService) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
  }
  
  /**
   * Find stash entry for a specific branch
   */
  private async findStashForBranch(git: SimpleGit, branchName: string): Promise<number | null> {
    try {
      const stashList = await git.stash(['list']);
      
      if (!stashList) {
        return null;
      }
      
      // Parse stash list output
      // Format: stash@{0}: On feature/skeleton: Auto-stash for feature/skeleton
      const lines = stashList.split('\n').filter((line: string) => line.trim());
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract stash message (after the colon)
        const messageMatch = line.match(/stash@\{(\d+)\}:\s*(.+)/);
        if (!messageMatch) continue;
        
        const stashIndex = parseInt(messageMatch[1], 10);
        const message = messageMatch[2];
        
        // Check if message contains our branch identifier
        if (message.includes(`Auto-stash for ${branchName}`)) {
          console.log(`[GitBranchService] 🔍 Found stash for ${branchName}: stash@{${stashIndex}}`);
          return stashIndex;
        }
      }
      
      console.log(`[GitBranchService] ℹ️  No stash found for ${branchName}`);
      return null;
      
    } catch (error) {
      console.error(`[GitBranchService] ⚠️  Error finding stash:`, error);
      return null;
    }
  }

  /**
   * Create branch-specific stash
   */
  private async createBranchStash(git: SimpleGit, branchName: string): Promise<boolean> {
    try {
      const status = await git.status();
      const hasChanges = status.files.length > 0;
      
      if (!hasChanges) {
        console.log(`[GitBranchService] ℹ️  No changes to stash for ${branchName}`);
        return false;
      }
      
      // Create stash with branch-specific message
      const stashMessage = `Auto-stash for ${branchName}`;
      await git.stash(['push', '-u', '-m', stashMessage]);
      
      console.log(`[GitBranchService] ✅ Created stash for ${branchName}: "${stashMessage}"`);
      return true;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create stash for ${branchName}: ${errorMsg}`);
    }
  }

  /**
   * Apply branch-specific stash
   */
  private async applyBranchStash(git: SimpleGit, branchName: string): Promise<void> {
    try {
      // Find stash for this branch
      const stashIndex = await this.findStashForBranch(git, branchName);
      
      if (stashIndex === null) {
        console.log(`[GitBranchService] ℹ️  No stash to apply for ${branchName}`);
        return;
      }
      
      console.log(`[GitBranchService] 🔄 Applying stash@{${stashIndex}} for ${branchName}...`);
      
      // Apply the specific stash
      await git.stash(['apply', `stash@{${stashIndex}}`]);
      
      console.log(`[GitBranchService] ✅ Applied stash for ${branchName}`);
      
      // Drop the stash after successful application
      await git.stash(['drop', `stash@{${stashIndex}}`]);
      console.log(`[GitBranchService] 🗑️  Dropped stash@{${stashIndex}}`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[GitBranchService] ⚠️  Failed to apply stash:`, errorMsg);
      throw new Error(`Failed to apply stash for ${branchName}: ${errorMsg}`);
    }
  }
  
  /**
   * Switch to feature branch (main entry point)
   * @returns Object containing branchName and current Git status
   */
  async switchToFeatureBranch(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<{ branchName: string; currentBranch: string }> {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    const configPath = path.join(projectPath, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error('Project config not found');
    }

    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    
    // Determine codebase path
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

    // Get Git instance
    const git = GitHelper.getGitInstanceSafe(codebasePath);
    if (!git) {
      throw new Error('Repository not initialized. Please clone or initialize first.');
    }

    const baseBranch = config.branchBase || 'main';
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => baseBranch);
    console.log(`[GitBranchService] 📍 Current branch: ${currentBranch}`);
    
    // Check if repository has any commits
    const log = await git.log({ maxCount: 1 }).catch(() => null);
    const hasCommits = log && log.latest;
    
    if (!hasCommits) {
      // Empty repository - create initial commit
      console.log(`[GitBranchService] 📝 Empty repository detected, creating initial commit...`);
      await git.add('.gitignore').catch(() => {
        const gitignorePath = path.join(codebasePath, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
          fs.writeFileSync(gitignorePath, 'node_modules/\n.env\n');
        }
      });
      await git.add('./*').catch(() => {});
      await git.commit('Initial commit', { '--allow-empty': null });
      console.log(`[GitBranchService] ✅ Initial commit created`);
      
      if (featureName === 'main' || featureName === baseBranch) {
        return baseBranch;
      }
    }
    
    // Create stash for current branch
    await this.createBranchStash(git, currentBranch);
    
    try {
      // Special case: checkout base branch
      if (featureName === 'main' || featureName === baseBranch) {
        console.log(`[GitBranchService] 🔀 Checking out base branch: ${baseBranch}`);
        await git.checkout(baseBranch);
        console.log(`[GitBranchService] ✅ Successfully checked out: ${baseBranch}`);
        
        // Verify branch after checkout
        const branchAfterCheckout = await git.revparse(['--abbrev-ref', 'HEAD']);
        console.log(`[GitBranchService] 📝 Current branch after checkout: ${branchAfterCheckout}`);
        
        // Set upstream for base branch if remote exists
        try {
          const remoteBranches = await git.branch(['-r']);
          if (remoteBranches.all.includes(`origin/${baseBranch}`)) {
            const hasUpstream = await git.revparse(['--abbrev-ref', `${baseBranch}@{upstream}`]).then(() => true).catch(() => false);
            if (!hasUpstream) {
              await git.branch(['--set-upstream-to', `origin/${baseBranch}`, baseBranch]);
              console.log(`[GitBranchService] ✅ Set upstream: ${baseBranch} -> origin/${baseBranch}`);
            }
          }
        } catch (err) {
          console.log(`[GitBranchService] Could not set upstream for ${baseBranch}:`, err);
        }
        
        console.log(`[GitBranchService] 🔄 Applying stash for: ${baseBranch}`);
        await this.applyBranchStash(git, baseBranch);
        console.log(`[GitBranchService] ✅ Stash applied successfully`);
        
        // Final verification
        const finalBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        console.log(`[GitBranchService] 🎯 Final branch: ${finalBranch}`);
        
        return { branchName: baseBranch, currentBranch: finalBranch };
      }
    
      // Feature branch handling
      const branchName = `feature/${featureName.toLowerCase().replace(/\s+/g, '-')}`;

      // Check remote branch existence
      let remoteExists = false;
      if (config.githubRepo && this.githubAuthService) {
        try {
          const credentialContext = {
            org: userContext.organizationId,
            user: userContext.userId
          };
          const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
            credentialContext,
            config.githubRepo
          );
          
          // Update remote URL
          try {
            const remotes = await git.getRemotes(true);
            const originExists = remotes.some(r => r.name === 'origin');
            if (originExists) {
              await git.remote(['set-url', 'origin', authenticatedUrl]);
              
              // ✅ Fix shallow clone: Update fetch refspec to get all branches
              await git.raw(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
              console.log(`[BranchService] Updated fetch refspec to fetch all branches`);
            } else {
              await git.addRemote('origin', authenticatedUrl);
            }
          } catch (remoteError) {
            console.log(`[GitBranchService] Could not update remote:`, remoteError);
          }
          
          // ✅ Unshallow if needed
          try {
            const isShallow = await git.revparse(['--is-shallow-repository']).then(r => r.trim() === 'true').catch(() => false);
            if (isShallow) {
              console.log(`[BranchService] Detected shallow clone, converting to full...`);
              await git.fetch(['--unshallow']);
              console.log(`[BranchService] ✅ Converted to full repository`);
            }
          } catch (unshallowError) {
            console.log(`[BranchService] Could not unshallow (non-critical):`, unshallowError);
          }
          
          // ✅ Check remote branch existence using branch -r after fetch
          await git.fetch(['origin']);
          const remoteBranches = await git.branch(['-r']);
          remoteExists = remoteBranches.all.includes(`origin/${branchName}`);
          console.log(`[BranchService] Remote branch check for ${branchName}: ${remoteExists ? 'EXISTS' : 'NOT FOUND'}`);
        } catch (fetchError) {
          console.log(`[GitBranchService] Could not check remote (non-critical):`, fetchError);
        }
      }

      // Check if branch exists locally
      const branches = await git.branchLocal();
      const branchExists = branches.all.includes(branchName);

      if (branchExists) {
        // Case 1: Local branch exists → checkout
        await git.checkout(branchName);
        console.log(`[BranchService] ✅ Checked out existing local branch: ${branchName}`);
        await this.applyBranchStash(git, branchName);
        
        // Verify current branch
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        console.log(`[BranchService] 🎯 Current branch after checkout: ${currentBranch}`);
        // Don't return yet - need to check upstream below
      } else if (remoteExists) {
        // Case 2: Remote exists → checkout from remote
        console.log(`[BranchService] ✅ Remote branch exists, creating local tracking branch: ${branchName}`);
        try {
          await git.checkout(['-b', branchName, '--track', `origin/${branchName}`]);
          console.log(`[BranchService] ✅ Checked out remote branch with tracking: origin/${branchName}`);
        } catch (checkoutErr: any) {
          console.log(`[BranchService] Checkout with tracking failed:`, checkoutErr.message);
          try {
            await git.checkoutBranch(branchName, `origin/${branchName}`);
            console.log(`[BranchService] ✅ Checked out remote branch: origin/${branchName}`);
          } catch (fallbackErr) {
            console.log(`[BranchService] ❌ All checkout attempts failed:`, fallbackErr);
            throw fallbackErr;
          }
        }
        await this.applyBranchStash(git, branchName);
      } else {
        // Case 3: Neither exists → create new branch
        const localBranches = await git.branchLocal();
        const baseBranchExists = localBranches.all.includes(baseBranch);
        
        if (!baseBranchExists) {
          console.log(`[BranchService] Base branch '${baseBranch}' not found locally, checking remote...`);
          try {
            await git.fetch(['origin', baseBranch]);
            const remoteBranches = await git.branch(['-r']);
            if (remoteBranches.all.includes(`origin/${baseBranch}`)) {
              await git.checkout(['-b', baseBranch, `origin/${baseBranch}`]);
              console.log(`[BranchService] ✅ Created local '${baseBranch}' from origin/${baseBranch}`);
            } else {
              throw new Error(`Base branch '${baseBranch}' not found on remote`);
            }
          } catch (fetchError) {
            throw new Error(`Base branch '${baseBranch}' not found locally or on remote. Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
          }
        } else {
          await git.checkout(baseBranch);
          console.log(`[BranchService] ✅ Checked out base branch: ${baseBranch}`);
        }
        
        // Create feature branch from base
        await git.checkoutLocalBranch(branchName);
        console.log(`[BranchService] ✅ Created new local branch: ${branchName}`);
      }

      // Handle upstream and push for new branches
      if (!branchExists && !remoteExists && config.githubRepo && this.githubAuthService) {
        console.log(`[BranchService] 🚀 Remote branch not found, pushing to create: ${branchName}`);
        try {
          const credentialContext = {
            org: userContext.organizationId,
            user: userContext.userId
          };
          const authenticatedUrl = await this.githubAuthService.buildAuthenticatedUrl(
            credentialContext,
            config.githubRepo
          );
          await git.remote(['set-url', 'origin', authenticatedUrl]).catch(() => git.addRemote('origin', authenticatedUrl));
          await git.push(['-u', 'origin', branchName]);
          console.log(`[BranchService] ✅ Pushed ${branchName} to remote and set upstream`);
        } catch (pushError: any) {
          console.error(`[BranchService] Failed to push new branch:`, pushError.message);
          // Recovery logic for push rejection
          if (pushError.message.includes('rejected') || pushError.message.includes('fetch first')) {
            console.log(`[BranchService] 🔄 Push rejected - remote branch exists but wasn't detected`);
            console.log(`[BranchService] 🔄 Fetching again and switching to remote branch...`);
            
            await git.fetch(['--all', '--prune']);
            const remoteBranches = await git.branch(['-r']);
            const remoteBranchName = `origin/${branchName}`;
            
            if (remoteBranches.all.includes(remoteBranchName)) {
              console.log(`[BranchService] ✅ Confirmed remote branch exists: ${remoteBranchName}`);
              
              // Delete local branch and checkout remote
              try {
                await git.checkout(baseBranch);
                await git.deleteLocalBranch(branchName, true);
                console.log(`[BranchService] 🗑️  Deleted out-of-sync local branch: ${branchName}`);
              } catch (deleteError) {
                console.log(`[GitBranchService] Could not delete local branch:`, deleteError);
              }
              
              await git.checkout(['-b', branchName, '--track', remoteBranchName]);
              console.log(`[GitBranchService] ✅ Checked out remote branch: ${branchName} tracking ${remoteBranchName}`);
            }
          }
        }
      } else if (branchExists || remoteExists) {
        // Branch exists locally or remote exists, try to ensure upstream is set
        try {
          const branchClean = branchName.trim();
          const hasUpstream = await git.revparse(['--abbrev-ref', `${branchClean}@{upstream}`]).then(() => true).catch(() => false);
          if (!hasUpstream) {
            // Check if remote branch exists
            const remoteBranches = await git.branch(['-r']);
            if (remoteBranches.all.includes(`origin/${branchName}`)) {
              await git.branch(['--set-upstream-to', `origin/${branchName}`, branchClean]);
              console.log(`[BranchService] ✅ Set upstream: ${branchClean} -> origin/${branchName}`);
            } else {
              console.log(`[BranchService] ℹ️  Remote branch not found, skipping upstream setup`);
            }
          } else {
            console.log(`[BranchService] ✅ Upstream already set for ${branchClean}`);
          }
        } catch (upstreamError: any) {
          // Non-critical: upstream setting failed (remote might not actually exist)
          console.log(`[BranchService] ⚠️ Could not set upstream (non-critical):`, upstreamError.message);
        }
      }
      
      // Final verification of current branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      console.log(`[BranchService] 🎯 Final current branch: ${currentBranch}`);
      
      return { branchName, currentBranch };
    } catch (error) {
      console.error(`[BranchService] ❌ Error during branch switch:`, error);
      throw error;
    }
  }
}
