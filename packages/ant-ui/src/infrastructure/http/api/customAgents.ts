import { API_BASE, authFetch, apiGet, apiPost, apiPatch, apiDelete, ApiError } from './client';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import type { CustomAgentSummary, CustomJobSummary, CustomAgentScope } from '@ant/shared';
import { getDownloadUrl } from './files';
import type { UploadFileEntry } from './files';
import { planUploadBatches, runUploadBatches } from '@/shared/utils/upload-utils';

export type { CustomAgentSummary, CustomJobSummary, CustomAgentScope };

/** One node of the universal artifacts workspace tree. */
export interface UniversalArtifactNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: UniversalArtifactNode[];
}

const projectBase = (projectId: string) =>
  `${API_BASE()}/projects/${encodeURIComponent(projectId)}`;

// ── Custom agents ───────────────────────────────────────────────────

export function fetchCustomAgents(projectId: string): Promise<{ agents: CustomAgentSummary[] }> {
  return apiGet(`${projectBase(projectId)}/custom-agents`);
}

/** Creation always targets the account (user) scope — definitions are account-owned. */
export function createCustomAgent(
  projectId: string,
  body: { id: string; name: string; description?: string },
): Promise<{ agent: CustomAgentSummary }> {
  return apiPost(`${projectBase(projectId)}/custom-agents`, body);
}

export function updateCustomAgent(
  projectId: string,
  agentId: string,
  patch: { name?: string; description?: string },
): Promise<{ agent: CustomAgentSummary }> {
  return apiPatch(
    `${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}`,
    patch,
  );
}

export function deleteCustomAgent(projectId: string, agentId: string): Promise<void> {
  return apiDelete(`${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}`);
}

// ── Custom jobs ─────────────────────────────────────────────────────

export function fetchCustomJobs(
  projectId: string,
  agentId: string,
): Promise<{ jobs: CustomJobSummary[] }> {
  return apiGet(`${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}/jobs`);
}

export function createCustomJob(
  projectId: string,
  agentId: string,
  body: { id: string; name: string },
): Promise<{ job: CustomJobSummary }> {
  return apiPost(
    `${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}/jobs`,
    body,
  );
}

export function updateCustomJob(
  projectId: string,
  agentId: string,
  jobId: string,
  patch: { name?: string },
): Promise<{ job: CustomJobSummary }> {
  return apiPatch(
    `${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}`,
    patch,
  );
}

export function deleteCustomJob(
  projectId: string,
  agentId: string,
  jobId: string,
): Promise<void> {
  return apiDelete(
    `${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}`,
  );
}

/** Definition validation — 400 carries `{ valid: false, error }`. */
export function validateCustomJob(
  projectId: string,
  agentId: string,
  jobId: string,
): Promise<{ valid: boolean; error?: string }> {
  return apiGet(
    `${projectBase(projectId)}/custom-agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(jobId)}/validate`,
  );
}

// ── Universal artifacts workspace ───────────────────────────────────

/**
 * `truncated` is additive and only present when the artifacts ROOT itself exhausted
 * the server's enumeration budget — the one case where no node in the tree can
 * carry the flag, so the response would otherwise look complete.
 */
export function fetchUniversalArtifactsTree(
  projectId: string,
): Promise<{ tree: UniversalArtifactNode[]; truncated?: boolean }> {
  return apiGet(`${projectBase(projectId)}/universal/artifacts/tree`);
}

/** Per-file upload refusal — the file is not readable as UTF-8 text (binary, or a legacy-encoded CSV). */
export interface RejectedUploadFile {
  path: string;
  reason: string;
}

/**
 * Upload into the merged workspace tree, batched.
 *
 * Sent as several requests when the folder is larger than one request may
 * carry — see `planUploadBatches`. A whole-batch 415 (`UNREADABLE_FILES`, which
 * the route answers when EVERY file in one request is unconsumable) is folded
 * into the aggregate `rejected[]` and the run continues: batching must not let
 * one all-binary batch abort an otherwise good folder. It is only re-thrown
 * when no batch uploaded anything.
 */
export async function uploadUniversalArtifacts(
  projectId: string,
  dirPath: string,
  entries: UploadFileEntry[],
): Promise<{ uploadedFiles: string[]; count: number; rejected: RejectedUploadFile[] }> {
  const plan = planUploadBatches(entries);
  const rejected: RejectedUploadFile[] = [];
  const uploadedFiles: string[] = [];
  let lastUnreadable: ApiError | null = null;

  const sendBatch = async (batch: UploadFileEntry[]) => {
    const formData = new FormData();
    formData.append('dirPath', dirPath);
    for (const entry of batch) {
      formData.append('files', entry.file);
      formData.append('relativePaths', entry.relativePath);
    }
    const response = await authFetch(`${projectBase(projectId)}/universal/artifacts/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(
        (err as any).error || (err as any).message || `Failed to upload files: ${response.statusText}`,
        response.status,
        err,
      );
    }
    return response.json().catch(() => ({}));
  };

  await runUploadBatches(plan, async (batch) => {
    let data: any;
    try {
      data = await sendBatch(batch);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNREADABLE_FILES') {
        if (err.rejected) rejected.push(...err.rejected);
        lastUnreadable = err;
        return;
      }
      throw err;
    }
    if (Array.isArray(data?.uploadedFiles)) uploadedFiles.push(...data.uploadedFiles);
    if (Array.isArray(data?.rejected)) rejected.push(...data.rejected);
  });

  if (uploadedFiles.length === 0 && lastUnreadable) throw lastUnreadable;

  return { uploadedFiles, count: uploadedFiles.length, rejected };
}

/**
 * Download URL for a universal artifact (JWT cookie auth, browser navigation).
 * Same route the codespace panel uses — it resolves the universal pseudo-feature
 * to the container's merged view and zip-streams directories.
 */
export function getUniversalArtifactDownloadUrl(projectId: string, path: string): string {
  return getDownloadUrl(projectId, UNIVERSAL_FEATURE, path);
}

export function createUniversalArtifactDirectory(
  projectId: string,
  path: string,
): Promise<void> {
  return apiPost(`${projectBase(projectId)}/universal/artifacts/mkdir`, { path });
}

/** Delete a file/dir in the merged workspace tree (canonical dirs are cleared, not removed). */
export function deleteUniversalArtifact(projectId: string, path: string): Promise<void> {
  return apiDelete(`${projectBase(projectId)}/universal/artifacts/file?path=${encodeURIComponent(path)}`);
}

/** Create an empty file (artifacts plane only — sessions is read-only). */
export function createUniversalArtifactFile(projectId: string, path: string): Promise<void> {
  return apiPost(`${projectBase(projectId)}/universal/artifacts/create-file`, { path });
}

/** Rename a file/dir (artifacts plane only — canonical roots and sessions are fixed). */
export function renameUniversalArtifact(projectId: string, path: string, newName: string): Promise<void> {
  return apiPost(`${projectBase(projectId)}/universal/artifacts/rename`, { path, newName });
}
