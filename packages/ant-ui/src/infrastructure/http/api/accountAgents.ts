/**
 * Account-scoped agent settings API (`/api/account/agents`) — the settings
 * screen opens from the profile menu without a selected project, so nothing
 * here takes a projectId.
 */

import { API_BASE, authFetch, apiGet, apiPost, apiDelete, apiPatch, apiPut, ApiError } from './client';
import type {
  CustomAgentSummary,
  CustomJobSummary,
  CustomAgentDefinitionFileNode,
  CustomAgentScope,
  CustomIntentDef,
  CustomJobPromptPreview,
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

/** Display-name rename (id is immutable — it IS the directory name). */
export function renameAccountAgent(agentId: string, name: string): Promise<{ success: boolean }> {
  return apiPatch(`${base()}/${encodeURIComponent(agentId)}`, { name });
}

export function renameAccountAgentJob(
  agentId: string,
  jobId: string,
  name: string,
): Promise<{ success: boolean }> {
  return apiPatch(`${base()}/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}`, { name });
}

export function createAccountAgentJob(
  agentId: string,
  body: { id: string; name: string },
): Promise<CustomJobSummary> {
  return apiPost(`${base()}/${encodeURIComponent(agentId)}/jobs`, body);
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

/** Composed-prompt preview — the exact system block the runtime injects for the given intents. */
export function fetchJobPromptPreview(
  agentId: string,
  jobId: string,
  intents?: string[],
): Promise<CustomJobPromptPreview> {
  const query = intents && intents.length > 0 ? `?intents=${encodeURIComponent(intents.join(','))}` : '';
  return apiGet(`${base()}/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}/prompt-preview${query}`);
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
