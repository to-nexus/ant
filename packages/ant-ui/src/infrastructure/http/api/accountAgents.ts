/**
 * Scoped agent-definition API (`/api/definitions/agents`) — the settings
 * screen opens from the profile menu without a selected project, so nothing
 * here takes a projectId.
 */

import { API_BASE, authFetch, apiGet, apiPost, apiDelete, apiPut, ApiError } from './client';
import type {
  CustomAgentSummary,
  CustomAgentOrgPermissions,
  CustomJobSummary,
  CustomAgentDefinitionFileNode,
  CustomAgentScope,
  CustomIntentDef,
  DefinitionValidationResult,
} from '@ant/shared';
import type { UploadFileEntry } from './files';
import { downloadAttachment } from './download';

export type { CustomAgentDefinitionFileNode, DefinitionValidationResult };

const base = () => `${API_BASE()}/definitions/agents`;

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

// ── org-owned agents (promotion + per-agent access) ──────────────────────────

/**
 * Promote a personal agent into the active team organization — a move (not a
 * copy); the caller becomes the agent owner in the org ACL.
 */
export function promoteAccountAgent(
  agentId: string,
): Promise<{ id: string; scope: 'org'; owner: string }> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/promote`, {});
}

/** Caller-specific permissions of an ACL-governed org agent. */
export function fetchAgentPermissions(agentId: string): Promise<CustomAgentOrgPermissions> {
  return apiGet(`${base()}/${encodeURIComponent(agentId)}/permissions`);
}

/** Replace the delegated editors list (owner ∨ org admin only). */
export function updateAgentEditors(
  agentId: string,
  editors: string[],
): Promise<CustomAgentOrgPermissions> {
  return apiPut(`${base()}/${encodeURIComponent(agentId)}/editors`, { editors });
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
  return apiGet(`${API_BASE()}/credentials/mcp`);
}

export function saveMcpCredential(key: string, value: string): Promise<{ success: boolean; key: string }> {
  return apiPut(`${API_BASE()}/credentials/mcp`, { key, value });
}

export function deleteMcpCredential(key: string): Promise<{ success: boolean }> {
  return apiDelete(`${API_BASE()}/credentials/mcp/${encodeURIComponent(key)}`);
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

export function createDefinitionDir(agentId: string, path: string): Promise<void> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/files/mkdir`, { path });
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

async function postMultipart(
  url: string,
  entries: UploadFileEntry[],
  fields?: Record<string, string>,
): Promise<DefinitionUploadResult> {
  const formData = new FormData();
  for (const entry of entries) {
    formData.append('files', entry.file);
    formData.append('relativePaths', entry.relativePath);
  }
  for (const [key, value] of Object.entries(fields ?? {})) formData.append(key, value);
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

/** `replaceDir` makes this a directory-unit REPLACE (job / intent folder upload). */
export function uploadDefinitionFiles(
  agentId: string,
  entries: UploadFileEntry[],
  options?: { replaceDir?: string },
): Promise<DefinitionUploadResult> {
  return postMultipart(
    `${base()}/${encodeURIComponent(agentId)}/files/upload`,
    entries,
    options?.replaceDir ? { replaceDir: options.replaceDir } : undefined,
  );
}

/**
 * Whole-agent folder export (ZIP) — the mirror of {@link importAgentFolder}.
 * The archive's single top-level folder is the agent id, so the downloaded and
 * unzipped folder feeds straight back into the folder-upload import.
 */
export function downloadAgentFolder(agentId: string): Promise<void> {
  return downloadAttachment(`${base()}/${encodeURIComponent(agentId)}/download`, `${agentId}.zip`);
}

/** Whole-agent import from a folder upload (webkitdirectory). */
export function importAgentFolder(
  entries: UploadFileEntry[],
  options?: { overwrite?: boolean },
): Promise<DefinitionUploadResult> {
  return postMultipart(`${base()}/import`, entries, options?.overwrite ? { overwrite: 'true' } : undefined);
}
