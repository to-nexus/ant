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
  execute?: string;           // Code execution node (code job only)
  tool?: string;              // Tool execution node
  validate?: string;          // Validation node (code job only)
  learn?: string;             // Learning node
  detectEnvironment?: string; // Environment detection node
  direct?: string;            // Art Direction node (visual job)
  sketch?: string;            // Sketch exploration node (visual job)
  render?: string;            // Final render node (visual job)
  engrave?: string;           // SVG code generation node (visual job)
  explain?: string;           // Explain node (visual job — text Q&A, no image gen)
}

/**
 * LLM Models Configuration per Job
 */
export interface LLMModels {
  design?: JobLLMConfig;      // Design job configuration
  code?: JobLLMConfig;        // Code job configuration
  learn?: JobLLMConfig;       // Learn job configuration
  plan?: JobLLMConfig;        // Plan job configuration (Planner agent)
  visual?: JobLLMConfig;      // Visual job configuration (Creator agent)
}

/**
 * Visual job settings
 */
export interface VisualSettings {
  candidateCount?: number;                         // Sketch candidate count (default: 3, range: 1-4)
  defaultAspectRatio?: string;                     // e.g. "1:1", "16:9"
  removeBackground?: boolean;                      // Enable bg-removal via visual-processor (default: true)
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
  
  // Git settings (branchBase is auto-detected at clone/init time; absent until then)
  branchBase?: string;              // Base branch for feature branches (e.g., 'main', 'develop')
  owner?: string;                   // GitHub owner (for repoType='github')
  repo?: string;                    // GitHub repo name (for repoType='github')
  
  // LLM settings
  // Priority: workspaceConfig.llmModels[job][node] > llmModels[job].default > env vars > hardcoded defaults
  // Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai, gemini-* = google)
  llmModels?: LLMModels;            // Job/Node-specific model configuration
  
  // Visual job settings
  visualSettings?: VisualSettings;
}

/**
 * Validate workspace config
 */
export function validateWorkspaceConfig(config: any): WorkspaceConfig {
  if (!config.projectName) {
    throw new Error('Config missing required field: projectName');
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
    llmModels: config.llmModels,
    visualSettings: config.visualSettings,
  };
}

/**
 * Default workspace config
 * If AI_MODEL_NAME env var is set, all jobs use that model (override).
 * Otherwise, design/code default to Opus, plan/learn default to Sonnet.
 */
export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  const envModel = process.env.AI_MODEL_NAME;
  const modelOpus = envModel || 'claude-opus-4-6';
  const modelSonnet = envModel || 'claude-sonnet-4-6';
  
  return {
    projectName,
    repoType: 'local',
    llmModels: {
      design: {
        default: modelOpus,
      },
      code: {
        default: modelOpus,
      },
      learn: {
        default: modelSonnet,
      },
      plan: {
        default: modelSonnet,
      },
      visual: {
        default: 'gemini-3-flash-preview',
        direct: 'gemini-3.1-pro-preview',
        explain: 'gemini-3.1-pro-preview',
        sketch: 'gemini-3.1-flash-image-preview',
        render: 'gemini-3-pro-image-preview',
        engrave: 'gemini-3.1-pro-preview',
      },
    },
    visualSettings: {
      candidateCount: 3,
      defaultAspectRatio: '1:1',
    },
  };
}

