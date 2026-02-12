import { UserConfigManager, GitHubCredentials } from '../../../utils/userConfig';
import { UserContext } from '../../../core/types/user';

// Simplified user context for GitHub operations (only org and user needed)
export interface CredentialUserContext {
  org: string;
  user: string;
}

export interface SavePATResult {
  success: boolean;
  username?: string;
  error?: string;
}

/**
 * GitHub Authentication Service
 * Manages GitHub Personal Access Tokens (PAT) for users
 */
export class GitHubAuthService {
  private readonly userConfig: UserConfigManager;
  
  constructor(workspaceRoot: string) {
    this.userConfig = new UserConfigManager(workspaceRoot);
  }
  
  /**
   * Convert UserContext to CredentialUserContext
   */
  private toCredentialContext(userContext: UserContext): CredentialUserContext {
    return {
      org: userContext.organizationId,
      user: userContext.userId
    };
  }

  /**
   * Validate PAT with GitHub API
   */
  private async validatePAT(pat: string): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ANT-CLI'
        }
      });
      
      if (response.ok) {
        const userData = await response.json() as { login: string };
        return { valid: true, username: userData.login };
      } else if (response.status === 401) {
        return { valid: false, error: 'Invalid or expired PAT' };
      } else {
        return { valid: false, error: `GitHub API error: ${response.status}` };
      }
    } catch (error: any) {
      return { valid: false, error: `Network error: ${error?.message || 'Unknown error'}` };
    }
  }

  /**
   * Save PAT for user (with validation)
   */
  async savePAT(userContext: CredentialUserContext, pat: string): Promise<SavePATResult> {
    // 1. Basic format validation
    if (!pat.startsWith('ghp_') && !pat.startsWith('github_pat_')) {
      return { 
        success: false, 
        error: 'Invalid PAT format. Expected format: ghp_xxx or github_pat_xxx' 
      };
    }
    
    // 2. Validate with GitHub API
    const validation = await this.validatePAT(pat);
    if (!validation.valid) {
      return { 
        success: false, 
        error: validation.error || 'PAT validation failed' 
      };
    }
    
    // 3. Save encrypted PAT using UserConfigManager
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    
    await this.userConfig.credentials.set<GitHubCredentials>(
      credContext,
      'github',
      {
        token: pat,
        tokenType: 'pat',
        username: validation.username
      }
    );
    
    return { 
      success: true, 
      username: validation.username 
    };
  }
  
  /**
   * Get GitHub username for user (from stored credentials)
   */
  async getUsername(userContext: CredentialUserContext): Promise<string | null> {
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    
    const credentials = await this.userConfig.credentials.get<GitHubCredentials>(credContext, 'github');
    return credentials?.username || null;
  }

  /**
   * Get PAT for user
   */
  async getPAT(userContext: CredentialUserContext): Promise<string | null> {
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    
    const credentials = await this.userConfig.credentials.get<GitHubCredentials>(credContext, 'github');
    return credentials?.token || null;
  }

  /**
   * Backward-compatible alias used by some older callers.
   * Prefer `getPAT()` for new code.
   */
  async getToken(userContext: CredentialUserContext): Promise<string> {
    const pat = await this.getPAT(userContext);
    if (!pat) {
      throw new Error(
        'GitHub PAT not configured. Please save your PAT in the Configuration screen (GitHub Integration section).'
      );
    }
    return pat;
  }
  
  /**
   * Check if user has configured PAT
   */
  async hasPAT(userContext: CredentialUserContext): Promise<boolean> {
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    
    return await this.userConfig.credentials.has(credContext, 'github');
  }
  
  /**
   * Delete PAT for user
   */
  async deletePAT(userContext: CredentialUserContext): Promise<void> {
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    
    await this.userConfig.credentials.delete(credContext, 'github');
  }
  
  /**
   * Build authenticated GitHub URL
   * @param userContext - User context
   * @param githubRepo - Repository (accepts "owner/repo" or full GitHub URL)
   * @returns Authenticated URL: https://{PAT}@github.com/owner/repo.git
   */
  async buildAuthenticatedUrl(userContext: CredentialUserContext, githubRepo: string): Promise<string> {
    const pat = await this.getPAT(userContext);
    
    if (!pat) {
      throw new Error(
        'GitHub PAT not configured. Please save your PAT in the Configuration screen (GitHub Integration section).'
      );
    }
    
    // Parse githubRepo to ensure "owner/repo" format
    const parsed = this.parseGitHubRepo(githubRepo);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository format: ${githubRepo}`);
    }
    
    // Output: https://{PAT}@github.com/owner/repo.git
    return `https://${pat}@github.com/${parsed}.git`;
  }
  
  /**
   * Parse GitHub repo from URL
   * @param url - GitHub URL (https://github.com/owner/repo.git or github.com/owner/repo)
   * @returns Repository in format "owner/repo" or null
   */
  parseGitHubRepo(url: string): string | null {
    const patterns = [
      /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/i,
      /^([^/]+)\/([^/]+)$/  // Direct format: owner/repo
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    }
    
    return null;
  }

  /**
   * Check if GitHub repository exists
   */
  async checkRepoExists(userContext: UserContext, githubRepo: string): Promise<boolean> {
    const credContext = this.toCredentialContext(userContext);
    const pat = await this.getPAT(credContext);
    if (!pat) {
      throw new Error('GitHub PAT not configured. Please save your PAT in the Configuration screen (GitHub Integration section).');
    }

    // ✅ Parse githubRepo to ensure "owner/repo" format
    const parsed = this.parseGitHubRepo(githubRepo);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository format: ${githubRepo}`);
    }

    const [owner, repo] = parsed.split('/');
    if (!owner || !repo) {
      throw new Error('Invalid GitHub repo format. Expected: owner/repo');
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ANT-CLI'
        }
      });

      return response.ok; // 200: exists, 404: not found
    } catch (error) {
      console.error('Error checking repo existence:', error);
      return false;
    }
  }

  /**
   * Create a new GitHub repository
   */
  async createRepo(
    userContext: UserContext, 
    githubRepo: string,
    options?: {
      description?: string;
      private?: boolean;
    }
  ): Promise<void> {
    const credContext = this.toCredentialContext(userContext);
    const pat = await this.getPAT(credContext);
    if (!pat) {
      throw new Error('GitHub PAT not configured. Please save your PAT in the Configuration screen (GitHub Integration section).');
    }

    // ✅ Parse githubRepo to ensure "owner/repo" format
    const parsed = this.parseGitHubRepo(githubRepo);
    if (!parsed) {
      throw new Error(`Invalid GitHub repository format: ${githubRepo}`);
    }

    const [owner, repoName] = parsed.split('/');
    if (!owner || !repoName) {
      throw new Error('Invalid GitHub repo format. Expected: owner/repo');
    }

    // Check if it's a user repo or org repo
    // For simplicity, create under user account
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ANT-CLI'
      },
      body: JSON.stringify({
        name: repoName,
        description: options?.description || `Generated by ANT`,
        private: options?.private ?? true, // Default to private
        auto_init: false // We'll do initial commit ourselves
      })
    });

    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(`Failed to create GitHub repo: ${error.message || response.statusText}`);
    }

    console.log(`✅ GitHub repo created: ${parsed}`);
  }
}

