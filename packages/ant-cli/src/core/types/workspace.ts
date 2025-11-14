/**
 * Workspace Configuration Types
 */

/**
 * Repository type
 * - local: Local file system (development)
 * - cloud: Cloud workspace (multi-tenant)
 * - github: GitHub repository
 */
export type RepoType = 'local' | 'cloud' | 'github';

/**
 * Workspace Configuration
 * Defines project settings and repository location
 */
export interface WorkspaceConfig {
  // Project identification
  projectName: string;
  
  // Repository settings
  repoType?: RepoType;              // Default: 'local'
  localPath?: string;               // Local repository path (ONLY for repoType='local')
                                     // Not used for 'cloud' or 'github' types
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
  // Priority: workspace config > agent-specific env vars > generic env vars > hardcoded defaults
  // Agent-specific env vars: {AGENT}_MODEL_PROVIDER, {AGENT}_MODEL_NAME (e.g., ARCHITECT_MODEL_PROVIDER)
  // Generic env vars: AI_MODEL_PROVIDER, AI_MODEL_NAME
  llmProvider?: 'anthropic' | 'openai';  // Default: 'anthropic'
  llmModel?: string;                     // Default: 'claude-3-5-sonnet-20241022'
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
  
  if (repoType === 'cloud') {
    // Cloud mode: No localPath required (workspace is in cloud storage)
    // Validate that localPath is NOT present
    if (config.localPath) {
      console.warn('[Config] localPath should not be set for cloud mode, ignoring...');
      delete config.localPath;
    }
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
 * Reads from environment variables if available:
 * - ARCHITECT_MODEL_PROVIDER or AI_MODEL_PROVIDER
 * - ARCHITECT_MODEL_NAME or AI_MODEL_NAME
 */
export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  // Read from environment variables (agent-specific or generic)
  const llmProvider = (
    process.env.ARCHITECT_MODEL_PROVIDER || 
    process.env.AI_MODEL_PROVIDER || 
    'anthropic'
  ) as 'anthropic' | 'openai';
  
  const llmModel = (
    process.env.ARCHITECT_MODEL_NAME || 
    process.env.AI_MODEL_NAME
  );
  
  return {
    projectName,
    repoType: 'local',
    branchBase: 'main',
    autoLearn: true,
    llmProvider,
    llmModel
  };
}

