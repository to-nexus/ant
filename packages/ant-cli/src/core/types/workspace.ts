/**
 * Workspace Configuration Types
 */

// JobLLMConfig / ModelNodeKey are owned by @ant/shared (llm-slots.ts) so the FE
// picker, BE defaults, and factory nodeType union share one shape. Imported for
// local use (LLMModels below) and re-exported so existing
// `import { JobLLMConfig } from '.../workspace'` sites keep working.
import type { JobLLMConfig, ModelNodeKey } from '@ant/shared';
export type { JobLLMConfig, ModelNodeKey };

/**
 * Repository type
 * - local: Local file system (development)
 * - cloud: Cloud workspace (multi-tenant)
 * - github: GitHub repository
 */
export type RepoType = 'local' | 'cloud' | 'github';

/**
 * LLM Models Configuration per Job
 */
export interface LLMModels {
  design?: JobLLMConfig;      // Design job configuration
  code?: JobLLMConfig;        // Code job configuration
  learn?: JobLLMConfig;       // Learn job configuration
  plan?: JobLLMConfig;        // Plan job configuration (Planner agent)
  visual?: JobLLMConfig;      // Visual job configuration (Creator agent)
  reviewer?: JobLLMConfig;    // Reviewer agent configuration
  doc?: JobLLMConfig;         // Doc agent configuration
  commit?: JobLLMConfig;      // Auxiliary (non-graph) commit-message model
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
 * - "claude-haiku-4-5-20251001" → "CLAUDE HAIKU 4 5"
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

import type { Domain } from '@ant/shared';
import { DEFAULT_MODELS } from '@ant/shared';

/**
 * Workspace Configuration
 * Defines project settings and repository location.
 *
 * Phase 2 (D22): `domain` is a workspace-level 1st-class slot, default
 * `'service'`. ActionsPanel renders the domain selector at its TOP screen,
 * sticky once chosen — individual intents cannot override. The current
 * domain is exposed as a read-only chip at lower wizard depths.
 */
export interface WorkspaceConfig {
  // Project identification
  projectName: string;

  /**
   * Project domain (Phase 2 — D22). Default `'service'`.
   * - `'service'` — SaaS / web app domain. UI design via `visual/ui/`,
   *   asset pool via `assets/service/`. game-art intents are hidden
   *   from ActionsPanel (matrix gate: TIER_DOMAIN_MATRIX.gameArtTier=['game']).
   * - `'game'` — game domain. UI design AND game-art design active in
   *   parallel; asset pool via `assets/game/`.
   *
   * The domain is sticky at the workspace level; intents inherit it via
   * `actionMetadata.domain` (which the BE detect node treats as explicit
   * override per 10.2 — explicit > infer).
   */
  domain?: Domain;
  
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
  
  // Phase 2 (D22): domain is a 1st-class workspace slot, default 'service'.
  // Validated as enum to keep accidental values out of the gate machinery.
  const allowedDomains: ReadonlyArray<Domain> = ['service', 'game'];
  const domain: Domain | undefined = (() => {
    if (config.domain === undefined || config.domain === null) return undefined;
    if (allowedDomains.includes(config.domain)) return config.domain as Domain;
    console.warn(`[Config] Unknown workspace.domain="${config.domain}", falling back to 'service'`);
    return 'service';
  })();

  return {
    projectName: config.projectName,
    domain,
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
 * Otherwise, plan/design/code default to the Sonnet tier; learn defaults to
 * the Haiku tier; reviewer/doc default to the Opus tier. Tier ids come from
 * the DEFAULT_MODELS SSOT (@ant/shared/models.ts) — never hardcode a model id here.
 */
/**
 * Get the minimal default LLM config for merging during load-time.
 * This provides ONLY the job-level `default` for each job, no node-specific overrides.
 * This ensures that existing projects that have only customized a job's `default`
 * can genuinely fall through to that `default` for all node types via `resolveModelForContext`.
 *
 * Node-specific opinionated defaults (decompose=Opus, plan=Opus) MUST be part of the
 * creation-time snapshot only (getDefaultWorkspaceConfig), not the load-time merge base.
 */
export function getConfigMergeDefaults(): LLMModels {
  const envModel = process.env.AI_MODEL_NAME;
  const modelOpus = envModel || DEFAULT_MODELS.opusTier;
  const modelSonnet = envModel || DEFAULT_MODELS.sonnetTier;
  const modelHaiku = envModel || DEFAULT_MODELS.haikuTier;

  return {
    design: { default: modelSonnet },
    code: { default: modelSonnet },
    learn: { default: modelHaiku },
    plan: { default: modelSonnet },
    visual: {
      default: 'gemini-3-flash',
    },
    reviewer: { default: modelOpus },
    doc: { default: modelOpus },
    // Auxiliary (non-graph) one-shot calls (e.g. ant-authored commit messages)
    // default to the Sonnet tier — cheap enough for a short call, but capable
    // enough to write a coherent commit message from a diff.
    commit: { default: modelSonnet },
  };
}

export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  const envModel = process.env.AI_MODEL_NAME;
  const modelOpus = envModel || DEFAULT_MODELS.opusTier;
  const modelSonnet = envModel || DEFAULT_MODELS.sonnetTier;

  return {
    projectName,
    // Phase 2 (D22): default project domain is 'service'.
    domain: 'service',
    repoType: 'local',
    llmModels: {
      design: {
        default: modelSonnet,
        decompose: modelSonnet,
        plan: modelOpus,
        execute: modelSonnet,
      },
      code: {
        default: modelSonnet,
        decompose: modelOpus,
        plan: modelSonnet,
        execute: modelSonnet,
      },
      learn: {
        default: modelSonnet,
      },
      plan: {
        // plan job split into plan (observe/clarify/seal) + execute (author):
        // the plan node reasons over the codebase → Opus; execute authors the
        // document from the sealed brief → Sonnet (job default).
        default: modelSonnet,
        plan: modelOpus,
        execute: modelSonnet,
      },
      visual: {
        default: 'gemini-3-flash',
        direct: 'gemini-3.1-pro-preview',
        explain: 'gemini-3.1-pro-preview',
        sketch: 'gemini-3.1-flash-image',
        render: 'gemini-3-pro-image',
        engrave: 'gemini-3.1-pro-preview',
      },
      reviewer: {
        default: modelOpus,
      },
      doc: {
        default: modelOpus,
      },
      commit: {
        default: modelSonnet,
      },
    },
    visualSettings: {
      candidateCount: 3,
      defaultAspectRatio: '1:1',
    },
  };
}

