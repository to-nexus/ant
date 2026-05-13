import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { UserContext } from '../../../../../../../core/types/user';
import { Octokit } from '@octokit/rest';
import { GitAuthError, GitOperationError } from '../../errors';

/**
 * RemoteChecker
 * 
 * Checks if a remote Git repository exists on GitHub.
 * Uses GitHub REST API for reliable verification.
 */
export class RemoteChecker {
  /**
   * Check if remote repository exists
   * 
   * @param githubRepo - GitHub repository URL (e.g., 'https://github.com/owner/repo')
   * @param userContext - User context for authentication
   * @param githubAuthService - GitHub authentication service
   * @returns true if repository exists, false otherwise
   */
  static async exists(
    githubRepo: string,
    userContext: UserContext,
    githubAuthService?: GitHubAuthService
  ): Promise<boolean> {
    if (!githubAuthService) {
      console.warn('[RemoteChecker] No GitHub auth service provided');
      return false;
    }

    try {
      // Extract owner/repo from GitHub URL
      // Supports: https://github.com/owner/repo, git@github.com:owner/repo.git
      const match = githubRepo.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
      if (!match) {
        console.warn('[RemoteChecker] Invalid GitHub URL format:', githubRepo);
        return false;
      }

      const [, owner, repo] = match;
      console.log(`[RemoteChecker] Checking repository: ${owner}/${repo}`);

      // Get GitHub token
      const credentialContext = {
        org: userContext.organizationId,
        user: userContext.userId
      };

      const token = await githubAuthService.getToken(credentialContext);
      // Suppress Octokit's default warn-level "GET ... - 404" line — the 404
      // path is a normal "not yet published" signal in our Setup flow, not an
      // error. Real failures still throw and are logged by callers.
      const octokit = new Octokit({
        auth: token,
        // Hard ceiling on the GitHub round-trip — keeps the validation step
        // bounded if TLS/proxy stalls, mirroring the timeout already applied
        // to direct fetch calls in GitHubAuthService.
        request: { timeout: 30_000 },
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: (msg: string) => console.error('[RemoteChecker][octokit]', msg),
        },
      });

      try {
        // Try to get repository info via GitHub API
        await octokit.repos.get({ owner, repo });
        console.log(`[RemoteChecker] ✅ Repository exists: ${owner}/${repo}`);
        return true;
      } catch (error: any) {
        if (error?.status === 404) {
          console.log(`[RemoteChecker] Repository not yet published (404): ${owner}/${repo}`);
          return false;
        }

        if (error?.status === 401 || error?.status === 403) {
          throw new GitAuthError(
            `GitHub authentication failed while verifying repository existence (${error.status}). ` +
            `Please check your GitHub PAT (and scopes) in Configuration.`
          );
        }

        throw new GitOperationError(
          `Could not verify repository existence (${error?.status || 'unknown'}): ${owner}/${repo}. ` +
          `${error?.message || ''}`.trim()
        );
      }
    } catch (error: any) {
      // Bubble up with a clean error message; callers can decide how to handle this.
      console.error('[RemoteChecker] Error checking repository:', error?.message || error);
      if (error instanceof GitOperationError) throw error;
      throw new GitOperationError(error?.message || String(error));
    }
  }
}

