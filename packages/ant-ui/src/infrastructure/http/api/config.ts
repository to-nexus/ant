import { API_BASE, authFetch, apiPut } from './client';

export interface JobLLMConfig {
  default?: string;
  decompose?: string;
  plan?: string;
  docGen?: string;
  codeGen?: string;
  tool?: string;
  validate?: string;
  learn?: string;
  detectEnvironment?: string;
}

export interface ProjectConfig {
  repositoryName: string;
  repoType?: 'local' | 'cloud' | 'github';
  localPath?: string;
  githubRepo?: string;
  branchBase?: string;
  llmModels?: {
    design?: JobLLMConfig;
    code?: JobLLMConfig;
    learn?: JobLLMConfig;
    plan?: JobLLMConfig;
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

/** Create project config with defaults */
export async function createProjectConfig(
  projectId: string,
  mode: 'local' | 'cloud' = 'local',
): Promise<ProjectConfig> {
  const sanitizedName = sanitizeRepositoryName(projectId);
  const defaultConfig: ProjectConfig = {
    repositoryName: sanitizedName,
    repoType: mode === 'cloud' ? 'cloud' : 'local',
    ...(mode !== 'cloud' ? { localPath: `~/dev/${sanitizedName}` } : {}),
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
