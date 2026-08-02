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

import type { Domain, GameArtTier, VisualTier } from '@ant/shared';
import { sanitizeGameArtTier, sanitizeVisualTier } from '@ant/shared';
import { getDefaultJobModels, getDefaultLlmModels } from '../config/defaultModels';

/**
 * Workspace-persisted visual basis (settled tiers).
 *
 * The tier axes describe properties of the CODEBASE (e.g. gameArtTier's
 * `perspective` decides plain-Phaser vs enable3d render paths), so once a
 * job settles them they must not be re-inferred per job — LLM re-inference
 * at temperature > 0 flipped `perspective` 2d→3d on an unchanged project
 * and injected mutually-contradictory basis partials (focal-molding-board).
 * Written once by `persistSettledBasis` (decompose funnels), read back into
 * the RAC seed at detect. `techTier` is intentionally NOT here — the
 * codebase manifests are its SSOT (ProjectProfileDetector).
 */
export interface WorkspaceBasis {
  gameArtTier?: GameArtTier;
  visualTier?: VisualTier;
}

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

  /**
   * Settled visual basis (D22-adjacent). Absent until a decompose funnel
   * first settles a tier for this workspace; then carried into every
   * subsequent job's RAC as authoritative (explicit user overrides via the
   * wizard still win and update this slot).
   */
  basis?: WorkspaceBasis;

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

  // Settled visual basis — per-axis whitelist via the registry sanitizers
  // (invalid axis values are dropped with a warn, never coerced). Absent /
  // fully-invalid input yields `undefined` (basis stays unsettled).
  const basis: WorkspaceBasis | undefined = (() => {
    if (!config.basis || typeof config.basis !== 'object') return undefined;
    const gameArtTier = sanitizeGameArtTier(config.basis.gameArtTier);
    const visualTier = sanitizeVisualTier(config.basis.visualTier);
    if (config.basis.gameArtTier && !gameArtTier) {
      console.warn('[Config] workspace.basis.gameArtTier had no valid axis values — dropped');
    }
    if (config.basis.visualTier && !visualTier) {
      console.warn('[Config] workspace.basis.visualTier had no valid layer values — dropped');
    }
    if (!gameArtTier && !visualTier) return undefined;
    return {
      ...(gameArtTier ? { gameArtTier } : {}),
      ...(visualTier ? { visualTier } : {}),
    };
  })();

  return {
    projectName: config.projectName,
    domain,
    basis,
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
 * Job-level default LLM config for the load-time merge — ONLY each job's `default`,
 * no node-specific overrides, so a project that customized just `job.default` falls
 * through to it for every node via `resolveModelForContext`. Node-specific opinionated
 * defaults belong to the creation-time snapshot (`getDefaultWorkspaceConfig`) only.
 *
 * Both are derived from the single binding table in `core/config/defaultModels.ts` —
 * never re-list model ids here.
 */
export function getConfigMergeDefaults(): LLMModels {
  return getDefaultJobModels();
}

export function getDefaultWorkspaceConfig(projectName: string): WorkspaceConfig {
  return {
    projectName,
    // Phase 2 (D22): default project domain is 'service'.
    domain: 'service',
    repoType: 'local',
    llmModels: getDefaultLlmModels(),
    visualSettings: {
      candidateCount: 3,
      defaultAspectRatio: '1:1',
    },
  };
}

