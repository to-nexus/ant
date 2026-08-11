/**
 * Account-scoped agent settings API (`/api/account/agents`) — the settings
 * screen opens from the profile menu without a selected project, so nothing
 * here takes a projectId.
 */

import { API_BASE, authFetch, apiGet, apiPost, apiDelete, apiPut, ApiError } from './client';
import type {
  CustomAgentSummary,
  CustomJobSummary,
  CustomAgentDefinitionFileNode,
  CustomAgentScope,
  CustomIntentDef,
  DefinitionValidationResult,
} from '@ant/shared';
import type { UploadFileEntry } from './files';

export type { CustomAgentDefinitionFileNode, DefinitionValidationResult };

const base = () => `${API_BASE()}/account/agents`;

export function fetchAccountAgents(): Promise<{
  agents: CustomAgentSummary[];
  builtinToolPreset: string[];
  mutatingBuiltinTools?: string[];
}> {
  return apiGet(base());
}

export function createAccountAgent(body: { id: string; name: string }): Promise<CustomAgentSummary> {
  return apiPost(base(), body);
}

export function deleteAccountAgent(agentId: string): Promise<void> {
  return apiDelete(`${base()}/${encodeURIComponent(agentId)}`);
}

/**
 * Change the agent's id. The id is the definition directory name, so the BE
 * moves that directory plus every session/plan folder keyed by it; the response
 * names the projects whose workspace data moved.
 */
export function renameAccountAgentId(
  agentId: string,
  newId: string,
): Promise<{ id: string; movedProjects: string[] }> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/rename`, { id: newId });
}

export function createAccountAgentJob(
  agentId: string,
  body: { id: string; name: string },
): Promise<CustomJobSummary> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/jobs`, body);
}

/**
 * Change a job's id — symmetric with {@link renameAccountAgentId}: the id is
 * the job directory name and keys the per-job session/plan data, so the BE
 * moves both and names the projects it swept.
 */
export function renameAccountAgentJobId(
  agentId: string,
  jobId: string,
  newId: string,
): Promise<{ id: string; movedProjects: string[] }> {
  return apiPost(
    `${base()}/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}/rename`,
    { id: newId },
  );
}

export function deleteAccountAgentJob(agentId: string, jobId: string): Promise<void> {
  return apiDelete(`${base()}/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}`);
}

export interface AccountJobValidation {
  valid: boolean;
  error?: string;
  builtinTools?: string[];
  mcpServers?: string[];
  intents?: CustomIntentDef[];
}

export function validateAccountAgentJob(agentId: string, jobId: string): Promise<AccountJobValidation> {
  return apiGet(`${base()}/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}/validate`);
}

// ── MCP credentials (encrypted per-user store; values are write-only) ────────

export interface McpCredentialSummary {
  key: string;
  updatedAt: string;
}

export function fetchMcpCredentials(): Promise<{ credentials: McpCredentialSummary[] }> {
  return apiGet(`${API_BASE()}/account/mcp-credentials`);
}

export function saveMcpCredential(key: string, value: string): Promise<{ success: boolean; key: string }> {
  return apiPut(`${API_BASE()}/account/mcp-credentials`, { key, value });
}

export function deleteMcpCredential(key: string): Promise<{ success: boolean }> {
  return apiDelete(`${API_BASE()}/account/mcp-credentials/${encodeURIComponent(key)}`);
}

// ── definition files ─────────────────────────────────────────────────────────

export function fetchDefinitionTree(agentId: string): Promise<{
  tree: CustomAgentDefinitionFileNode[];
  scope: CustomAgentScope;
  readonly: boolean;
}> {
  return apiGet(`${base()}/${encodeURIComponent(agentId)}/files`);
}

export function fetchDefinitionFile(agentId: string, path: string): Promise<{ path: string; content: string }> {
  return apiGet(`${base()}/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`);
}

/** The single definition write funnel — raw editor AND form sections. */
export function saveDefinitionFile(
  agentId: string,
  path: string,
  content: string,
): Promise<{ success: boolean; validation: DefinitionValidationResult }> {
  return apiPut(`${base()}/${encodeURIComponent(agentId)}/file`, { path, content });
}

export function createDefinitionFile(agentId: string, path: string): Promise<void> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/files/create`, { path });
}

export function renameDefinitionFile(agentId: string, path: string, newName: string): Promise<void> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/files/rename`, { path, newName });
}

export function deleteDefinitionFile(agentId: string, path: string): Promise<void> {
  return apiDelete(`${base()}/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`);
}

export interface DefinitionUploadResult {
  success: boolean;
  uploaded: string[];
  skipped: Array<{ path: string; reason: string }>;
  agentId?: string;
}

async function postMultipart(url: string, entries: UploadFileEntry[]): Promise<DefinitionUploadResult> {
  const formData = new FormData();
  for (const entry of entries) {
    formData.append('files', entry.file);
    formData.append('relativePaths', entry.relativePath);
  }
  const response = await authFetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new ApiError(
      (err as any).error || (err as any).message || `Upload failed: ${response.statusText}`,
      response.status,
      err,
    );
  }
  return response.json();
}

export function uploadDefinitionFiles(agentId: string, entries: UploadFileEntry[]): Promise<DefinitionUploadResult> {
  return postMultipart(`${base()}/${encodeURIComponent(agentId)}/files/upload`, entries);
}

/** Whole-agent import from a folder upload (webkitdirectory). */
export function importAgentFolder(entries: UploadFileEntry[]): Promise<DefinitionUploadResult> {
  return postMultipart(`${base()}/import`, entries);
}
