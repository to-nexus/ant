import { API_BASE, authFetch, apiPut } from './client';
import type { Domain } from '@ant/shared';

export interface JobLLMConfig {
  default?: string;
  decompose?: string;
  plan?: string;
  docGen?: string;
  execute?: string;
  tool?: string;
  validate?: string;
  learn?: string;
  detect?: string;
  direct?: string;
  sketch?: string;
  render?: string;
  engrave?: string;
}

export interface ProjectConfig {
  repositoryName: string;
  repoType?: 'local' | 'cloud' | 'github';
  localPath?: string;
  githubRepo?: string;
  branchBase?: string;
  /**
   * Workspace domain (Phase 2 — D22). Persisted on the BE in `config.json`
   * and treated as the SSOT for the project-level domain selector. The
   * FE mirrors this into `actionMetadata.domain` whenever the project
   * config loads, and writes back via PUT when the user toggles
   * `DomainToggle` so refresh / re-entry restore the same domain.
   */
  domain?: Domain;
  llmModels?: {
    design?: JobLLMConfig;
    code?: JobLLMConfig;
    learn?: JobLLMConfig;
    plan?: JobLLMConfig;
    visual?: JobLLMConfig;
  };
}

/** Fetch project config. Returns null if config doesn't exist (404). */
export async function fetchProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch config: ${response.statusText}`);
  return response.json();
}

function sanitizeRepositoryName(workspaceId: string): string {
  return workspaceId
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Create project config with defaults.
 *
 * `repoType` always defaults to `'cloud'` — the workspace-managed codebase
 * mode. The previous auto-mapping (`mode='local' -> repoType:'local' + localPath`)
 * was removed because it caused worktree path-collision (same codebase shared
 * between base and every feature) without explicit user opt-in. Users who want
 * the external `localPath` mode must set `repoType` and `localPath` explicitly
 * via `updateProjectConfig` (advanced wizard step) — see Three-Axis Task Modeling
 * principle in AGENTS.md.
 */
export async function createProjectConfig(projectId: string): Promise<ProjectConfig> {
  const sanitizedName = sanitizeRepositoryName(projectId);
  const defaultConfig: ProjectConfig = {
    repositoryName: sanitizedName,
    repoType: 'cloud',
  };
  await apiPut(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`,
    defaultConfig,
  );
  return defaultConfig;
}

export function updateProjectConfig(
  projectId: string,
  config: ProjectConfig,
): Promise<ProjectConfig> {
  return apiPut(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`,
    config,
  );
}
