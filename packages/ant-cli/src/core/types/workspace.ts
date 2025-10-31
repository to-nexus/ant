/**
 * Workspace Configuration Types
 */

/**
 * Repository type
 */
export type RepoType = 'local' | 'github';

/**
 * Workspace Configuration
 * Defines project settings and repository location
 */
export interface WorkspaceConfig {
  // Project identification
  projectName: string;
  
  // Repository settings
  repoType?: RepoType;              // Default: 'local'
  localPath?: string;               // Local repository path (absolute or relative to ANT repo root)
                                     // Examples: 
                                     //   - "../my-project" (sibling to ANT repo)
                                     //   - "/Users/user/projects/my-project" (absolute)
                                     //   - "~/projects/my-project" (home directory)
  
  // Git settings
  branchBase: string;               // Base branch for feature branches (e.g., 'main', 'develop')
  owner?: string;                   // GitHub owner (for repoType='github')
  repo?: string;                    // GitHub repo name (for repoType='github')
  
  // Agent settings
  autoLearn?: boolean;              // Auto-save learnings after generation (default: true)
  
  // Validation settings
  strictValidation?: boolean;       // Enable dynamic validation (build/lint/test) (default: false)
  runTests?: boolean;               // Run tests during validation (default: false)
  
  // LLM settings
  llmProvider?: 'anthropic' | 'openai';  // Default: from env
  llmModel?: string;                     // Default: from env
}

/**
 * Validate workspace config
 */
export function validateWorkspaceConfig(config: any): WorkspaceConfig {
  if (!config.projectName) {
    throw new Error('Config missing required field: projectName');
  }
  
  if (!config.branchBase) {
    throw new Error('Config missing required field: branchBase');
  }
  
  const repoType = config.repoType || 'local';
  
  if (repoType === 'local' && !config.localPath) {
    throw new Error('Config with repoType="local" requires localPath');
  }
  
  if (repoType === 'github' && (!config.owner || !config.repo)) {
    throw new Error('Config with repoType="github" requires owner and repo');
  }
  
  return {
    projectName: config.projectName,
    repoType: repoType,
    localPath: config.localPath,
    branchBase: config.branchBase,
    owner: config.owner,
    repo: config.repo,
    autoLearn: config.autoLearn ?? true,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
  };
}

/**
 * Default workspace config
 */
export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  return {
    projectName,
    repoType: 'local',
    branchBase: 'main',
    autoLearn: true,
    llmProvider: 'anthropic',
    llmModel: 'claude-3-5-sonnet-20241022'
  };
}

