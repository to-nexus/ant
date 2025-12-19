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
 * LLM Model Configuration per Job/Node
 * Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai)
 */
export interface LLMModels {
  // Design Job
  designDecompose?: string;    // Design job decompose phase
  designDefault?: string;      // Design job default (all other nodes)
  
  // Code Job
  codeDecompose?: string;      // Code job decompose phase
  codeError?: string;          // Code job error tasks
  codeFinal?: string;          // Code job final verification task (priority 1000)
  codeSetup?: string;          // Code job setup tasks (backend-project-setup, frontend-project-setup)
  codeDefault?: string;        // Code job default (detect env, feature, tool, etc)
}

/**
 * Generate display name from model name
 * Removes version suffix and capitalizes words
 * 
 * Examples:
 * - "claude-sonnet-4-20250929" → "Claude Sonnet 4"
 * - "gpt-4-turbo-preview" → "GPT 4 Turbo Preview"
 * - "o1-preview" → "O1 Preview"
 */
export function getModelDisplayName(modelName: string): string {
  return modelName
    .replace(/-\d{8}.*$/, '')  // Remove -20250929 and anything after
    .replace(/-\d{4}-\d{2}-\d{2}.*$/, '')  // Remove -2025-09-29 and anything after
    .split('-')
    .map(word => word.toUpperCase())  // Uppercase for better readability (GPT, O1, etc.)
    .join(' ');
}

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
  // Priority: workspace config > env vars (AI_MODEL_NAME) > hardcoded defaults
  // Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai)
  llmModels?: LLMModels;            // Job/Node-specific model configuration
  
  // DEPRECATED: Use llmModels instead
  llmProvider?: 'anthropic' | 'openai';  
  llmModel?: string;
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
    llmModels: config.llmModels,
    llmProvider: config.llmProvider,  // DEPRECATED
    llmModel: config.llmModel,        // DEPRECATED
  };
}

/**
 * Default workspace config
 * Reads default model from environment variable AI_MODEL_NAME
 */
export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  // Read default model from environment variable
  const defaultModel = process.env.AI_MODEL_NAME || 'claude-sonnet-4-5-20250929';  // ✅ Latest default
  
  return {
    projectName,
    repoType: 'local',
    branchBase: 'main',
    autoLearn: true,
    llmModels: defaultModel ? {
      designDecompose: defaultModel,
      designDefault: defaultModel,
      codeDecompose: defaultModel,
      codeError: defaultModel,
      codeFinal: defaultModel,
      codeSetup: defaultModel,  // ✅ Setup tasks
      codeDefault: defaultModel,
    } : undefined,
  };
}

