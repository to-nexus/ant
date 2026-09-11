/**
 * Scoped agent-definition API (`/api/definitions/agents`) — the settings
 * screen opens from the profile menu without a selected project, so nothing
 * here takes a projectId.
 */

import { API_BASE, authFetch, apiGet, apiPost, apiDelete, apiPut, ApiError } from './client';
import { DEFINITION_ICON_MIME } from '@ant/shared';
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
import { planUploadBatches, runUploadBatches } from '@/shared/utils/upload-utils';

export type { CustomAgentDefinitionFileNode, DefinitionValidationResult };

const base = () => `${API_BASE()}/definitions/agents`;

/** mime → the file name it must be stored under (the inverse of the BE map). */
const DEFINITION_ICON_NAME_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(DEFINITION_ICON_MIME).map(([name, mime]) => [mime, name]),
);

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
  /**
   * The loader dry run the server ran after writing — the same verdict `PUT
   * /file` returns. Multipart lanes write unvalidated bytes, so this is the
   * only place the client hears what the funnel would have refused.
   */
  validation?: DefinitionValidationResult;
}

async function postOneBatch(
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

interface MultipartBatchSpec {
  /** Fields for the FIRST batch only — where a destructive flag belongs. */
  firstFields?: Record<string, string>;
  /** Destination for batches 2..K. Defaults to the first batch's URL. */
  restUrl?: (first: DefinitionUploadResult) => string;
  /** Path rewrite for batches 2..K (`/import` strips the agent-id segment). */
  restPath?: (relativePath: string, first: DefinitionUploadResult) => string;
  pinFirst?: (entry: UploadFileEntry) => boolean;
  /**
   * Batch-granular progress. `authFetch` is `fetch`, which reports no upload
   * bytes, so a folder advances one batch at a time — coarse, but monotonic and
   * true, which a permanently-empty bar is not.
   */
  onProgress?: (loaded: number, total: number) => void;
  /** Checked BETWEEN batches — a folder upload is cancellable at that grain. */
  signal?: AbortSignal;
}

/**
 * Send a definition folder as batches the server will accept.
 *
 * Both destructive lanes (`replaceDir`, and `/import` + `overwrite`) `fs.rmSync`
 * the target BEFORE writing, so the destructive field must ride the FIRST batch
 * only — batches 2..K are pure appends, or batch 2 would delete what batch 1
 * wrote. `runUploadBatches` is sequential, which is what makes that ordering a
 * guarantee rather than a race.
 */
async function postMultipart(
  url: string,
  entries: UploadFileEntry[],
  spec: MultipartBatchSpec = {},
): Promise<DefinitionUploadResult> {
  const plan = planUploadBatches(entries, { pinFirst: spec.pinFirst });
  const uploaded: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let first: DefinitionUploadResult | undefined;
  let last: DefinitionUploadResult | undefined;

  await runUploadBatches(
    plan,
    async (batch, ctx) => {
      let result: DefinitionUploadResult;
      if (ctx.isFirst) {
        result = await postOneBatch(url, batch, spec.firstFields);
        first = result;
      } else {
        const rest = spec.restPath
          ? batch.map((e) => ({ ...e, relativePath: spec.restPath!(e.relativePath, first!) }))
          : batch;
        result = await postOneBatch(spec.restUrl ? spec.restUrl(first!) : url, rest);
      }
      if (Array.isArray(result.uploaded)) uploaded.push(...result.uploaded);
      if (Array.isArray(result.skipped)) skipped.push(...result.skipped);
      last = result;
    },
    { onProgress: spec.onProgress, signal: spec.signal },
  );

  // The LAST batch judged the whole tree; an earlier one judged a partial one.
  return { success: true, uploaded, skipped, agentId: first?.agentId, validation: last?.validation };
}

/**
 * The agent icon's bytes. The endpoint answers `Content-Disposition: attachment`
 * so a direct navigation can never render user bytes on the API origin — the
 * app therefore reads it here and renders it from a blob URL instead of putting
 * the URL in an `<img src>`.
 */
export async function fetchAgentIconBlob(agentId: string): Promise<Blob> {
  const response = await authFetch(`${base()}/${encodeURIComponent(agentId)}/icon`);
  if (!response.ok) throw new ApiError(`Failed to load agent icon`, response.status);
  return response.blob();
}

/**
 * Store an agent icon. There is no dedicated write route: the icon is a
 * whitelisted definition file, so it rides the one multipart definition lane,
 * which owns the magic-byte sniff, the size cap and the sibling-name unlink.
 */
export async function uploadAgentIcon(agentId: string, file: File): Promise<DefinitionUploadResult> {
  const name = DEFINITION_ICON_NAME_BY_MIME[file.type];
  if (!name) throw new ApiError(`Unsupported icon type: ${file.type || 'unknown'}`, 400);
  return uploadDefinitionFiles(agentId, [{ file, relativePath: name }]);
}

/** Remove whichever icon name the agent currently holds. */
export function deleteAgentIcon(agentId: string, name: string): Promise<void> {
  return deleteDefinitionFile(agentId, name);
}

/** `replaceDir` makes this a directory-unit REPLACE (job / intent folder upload). */
export function uploadDefinitionFiles(
  agentId: string,
  entries: UploadFileEntry[],
  options?: {
    replaceDir?: string;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<DefinitionUploadResult> {
  return postMultipart(`${base()}/${encodeURIComponent(agentId)}/files/upload`, entries, {
    // Batch 1 replaces the directory; the rest append into it.
    firstFields: options?.replaceDir ? { replaceDir: options.replaceDir } : undefined,
    onProgress: options?.onProgress,
    signal: options?.signal,
  });
}

/**
 * Whole-agent folder export (ZIP) — the mirror of {@link importAgentFolder}.
 * The archive's single top-level folder is the agent id, so the downloaded and
 * unzipped folder feeds straight back into the folder-upload import.
 */
export function downloadAgentFolder(agentId: string): Promise<void> {
  return downloadAttachment(`${base()}/${encodeURIComponent(agentId)}/download`, `${agentId}.zip`);
}

/**
 * Whole-agent import from a folder upload (webkitdirectory).
 *
 * `/import` validates its invariants per REQUEST — exactly one top-level folder
 * and `{agentId}/agent.yaml` at its root — so only batch 1 can go there. It
 * creates (and, with `overwrite`, replaces) the agent; batches 2..K append
 * through the definition-files route with the agent-id segment stripped, which
 * is the same rewrite `/import` performs server-side.
 */
export function importAgentFolder(
  entries: UploadFileEntry[],
  options?: {
    overwrite?: boolean;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  },
): Promise<DefinitionUploadResult> {
  return postMultipart(`${base()}/import`, entries, {
    firstFields: options?.overwrite ? { overwrite: 'true' } : undefined,
    onProgress: options?.onProgress,
    signal: options?.signal,
    // agent.yaml must be in the batch that hits /import, or it answers 400.
    pinFirst: (e) => /(^|\/)agent\.yaml$/.test(e.relativePath),
    restUrl: (first) => `${base()}/${encodeURIComponent(first.agentId ?? '')}/files/upload`,
    restPath: (rel) => rel.split('/').slice(1).join('/'),
  });
}
