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
 * LLM Model Configuration: Job -> Node hierarchy
 * Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai)
 */
export interface JobLLMConfig {
  default?: string;           // Job-level default model (used when node-specific model not set)
  decompose?: string;         // Decompose node (task planning)
  plan?: string;              // Plan node (context gathering, planning)
  docGen?: string;            // Documentation generation (design job only)
  codeGen?: string;           // Code generation (code job only)
  tool?: string;              // Tool execution node
  validate?: string;          // Validation node (code job only)
  learn?: string;             // Learning node
  detectEnvironment?: string; // Environment detection node
}

/**
 * LLM Models Configuration per Job
 */
export interface LLMModels {
  design?: JobLLMConfig;      // Design job configuration
  code?: JobLLMConfig;        // Code job configuration
  learn?: JobLLMConfig;       // Learn job configuration
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
  // Priority: workspaceConfig.llmModels[job][node] > llmModels[job].default > env vars > hardcoded defaults
  // Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai)
  llmModels?: LLMModels;            // Job/Node-specific model configuration
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
      design: {
        default: defaultModel,
      },
      code: {
        default: defaultModel,
      },
      learn: {
        default: defaultModel,
      },
    } : undefined,
  };
}

