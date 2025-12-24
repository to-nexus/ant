import { GitHubAuthService } from '../../../../../auth/GitHubAuthService';
import { UserContext } from '../../../../../../../core/types/user';

/**
 * RemoteChecker
 * 
 * Checks if a remote Git repository exists on GitHub.
 * Uses git ls-remote to verify repository existence.
 */
export class RemoteChecker {
  /**
   * Check if remote repository exists
   * 
   * @param githubRepo - GitHub repository (e.g., 'owner/repo')
   * @param userContext - User context for authentication
   * @param githubAuthService - GitHub authentication service
   * @returns true if repository exists, false otherwise
   */
  static async exists(
    githubRepo: string,
    userContext: UserContext,
    githubAuthService?: GitHubAuthService
  ): Promise<boolean> {
    try {
      // Build authenticated URL
      const credentialContext = {
        org: userContext.organizationId,
        user: userContext.userId
      };
      
      if (!githubAuthService) {
        return false;
      }
      
      const authenticatedUrl = await githubAuthService.buildAuthenticatedUrl(
        credentialContext,
        githubRepo
      );

      // Try git ls-remote to check if repository exists
      const { execSync } = await import('child_process');
      try {
        execSync(`git ls-remote ${authenticatedUrl}`, { 
          stdio: 'pipe',
          timeout: 10000 
        });
        return true; // Repository exists
      } catch (error) {
        return false; // Repository doesn't exist or auth failed
      }
    } catch (error) {
      console.warn('[RemoteChecker] Could not check remote repository:', error);
      return false; // Assume doesn't exist on error
    }
  }
}

