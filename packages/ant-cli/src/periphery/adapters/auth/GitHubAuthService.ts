import { CredentialStore } from '../../../utils/credentialStore';
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
  private readonly credentialStore: CredentialStore;
  
  constructor(workspaceRoot: string) {
    this.credentialStore = new CredentialStore(workspaceRoot);
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
    const validation = await this.credentialStore.validatePAT(pat);
    if (!validation.valid) {
      return { 
        success: false, 
        error: validation.error || 'PAT validation failed' 
      };
    }
    
    // 3. Save encrypted PAT
    // Convert to UserContext format
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    await this.credentialStore.savePAT(credContext, pat);
    
    return { 
      success: true, 
      username: validation.username 
    };
  }
  
  /**
   * Get PAT for user
   */
  async getPAT(userContext: CredentialUserContext): Promise<string | null> {
    // Convert to UserContext format
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    return await this.credentialStore.getPAT(credContext);
  }
  
  /**
   * Check if user has configured PAT
   */
  async hasPAT(userContext: CredentialUserContext): Promise<boolean> {
    // Convert to UserContext format
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    return await this.credentialStore.hasPAT(credContext);
  }
  
  /**
   * Delete PAT for user
   */
  async deletePAT(userContext: CredentialUserContext): Promise<void> {
    // Convert to UserContext format
    const credContext: UserContext = {
      organizationId: userContext.org,
      userId: userContext.user,
      workspacePath: ''
    };
    await this.credentialStore.deletePAT(credContext);
  }
  
  /**
   * Build authenticated GitHub URL
   * @param userContext - User context
   * @param githubRepo - Repository (accepts "owner/repo" or full GitHub URL)
   * @returns Authenticated URL: https://{PAT}@github.com/owner/repo.git
   */
  async buildAuthenticatedUrl(userContext: CredentialUserContext, githubRepo: string): Promise<string> {
    console.log(`[GitHubAuthService] buildAuthenticatedUrl called`);
    console.log(`[GitHubAuthService]   org="${userContext.org}", user="${userContext.user}"`);
    console.log(`[GitHubAuthService]   githubRepo="${githubRepo}"`);
    
    const pat = await this.getPAT(userContext);
    
    if (!pat) {
      console.error(`[GitHubAuthService] ❌ PAT not found!`);
      throw new Error(
        'GitHub PAT not configured. Please save your PAT in the Configuration screen (GitHub Integration section).'
      );
    }
    
    console.log(`[GitHubAuthService] ✅ PAT found (length: ${pat.length})`);
    
    // ✅ Parse githubRepo to ensure "owner/repo" format
    const parsed = this.parseGitHubRepo(githubRepo);
    if (!parsed) {
      console.error(`[GitHubAuthService] ❌ Failed to parse GitHub repo: ${githubRepo}`);
      throw new Error(`Invalid GitHub repository format: ${githubRepo}`);
    }
    
    console.log(`[GitHubAuthService] Parsed repo: ${parsed}`);
    
    // Output: https://{PAT}@github.com/owner/repo.git
    const url = `https://${pat}@github.com/${parsed}.git`;
    console.log(`[GitHubAuthService] ✅ Authenticated URL built (with PAT masked)`);
    return url;
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
      const error = await response.json();
      throw new Error(`Failed to create GitHub repo: ${error.message || response.statusText}`);
    }

    console.log(`✅ GitHub repo created: ${parsed}`);
  }
}

