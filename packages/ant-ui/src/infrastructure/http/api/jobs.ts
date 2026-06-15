import { API_BASE, authFetch, apiGet, apiPost, apiDelete } from './client';

/**
 * One row in the Job-tab dropdown — a previously executed (or currently
 * running) job for the same feature × jobType.
 *
 * `kanbanSnapshot` is the final sealed kanban captured when the job
 * finished. Present for completed runs; absent for live jobs (their data
 * lives in the store's kanban slice) and for historical runs that predate
 * snapshot persistence. The FE renders time / token badges only when it
 * can derive them from this snapshot or from live store state.
 */
export interface JobHistoryEntry {
  jobId: string;
  type: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  /** True when Redis still holds live state (running / paused). */
  live: boolean;
  kanbanSnapshot?: import('@ant/shared').KanbanData;
}

export interface ExecuteJobParams {
  projectId: string;
  featureName?: string;
  jobType?: string;
  agent?: string;
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  overrideDirective?: string;
  chatSource?: boolean;
  skipTriage?: boolean;
  actionMetadata?: import('@ant/shared').ActionMetadata;
  /**
   * Pre-allocated turnId from `/chat/user-message` so the worker reuses
   * it for the durable user_turn line (chat SSOT §6).
   */
  seedTurnId?: string;
}

// `JobStatus` interface was removed along with `fetchJobStatus` — the
// endpoint it described is not reachable from ant-ui.

/**
 * Execute a job. Has custom logic for prerequisites validation.
 */
export async function executeJob(
  params: ExecuteJobParams,
): Promise<{ jobId: string; error?: string; missingMaterials?: any[]; existingJobId?: string; isInterrupted?: boolean }> {
  const {
    projectId,
    featureName,
    jobType: task = 'code',
    agent,
    mode = 'generate',
    language = 'en',
    overrideDirective,
    chatSource,
    skipTriage,
    actionMetadata,
    seedTurnId,
  } = params;

  if (!featureName) {
    throw new Error('Feature name is required for job execution');
  }

  const requestBody = { task, agent, mode, language, overrideDirective, chatSource, skipTriage, actionMetadata, seedTurnId };
  const endpoint = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/execute`;

  const response = await authFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  // Prerequisites validation failure
  if (!data.success && data.error && data.missingMaterials) {
    return { jobId: data.jobId, error: data.error, missingMaterials: data.missingMaterials };
  }

  // 409 Conflict: another job is already running or interrupted
  if (response.status === 409 && data.existingJobId) {
    return { jobId: '', error: data.error, existingJobId: data.existingJobId, isInterrupted: data.isInterrupted ?? false };
  }

  if (!response.ok) {
    throw new Error(`Failed to execute task: ${response.statusText}`);
  }

  return data;
}

/**
 * List the feature's board-bearing jobs (code/design/learn), most-recent
 * first, each entry tagged with its own `type`. Source-merged from Redis
 * (live) and the session files' `runs[]` arrays across types. Feature-wide:
 * not scoped to the currently-selected job type.
 */
export function fetchJobHistory(
  projectId: string,
  featureName: string,
): Promise<{ jobs: JobHistoryEntry[] }> {
  return apiGet<{ jobs: JobHistoryEntry[] }>(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/jobs`,
  ).catch(() => ({ jobs: [] }));
}

/**
 * Per-jobId "full wipe" — deletes every artifact (Redis + BullMQ + disk +
 * session runs entry + feature.jsonl collapse) tied to this jobId. The BE
 * refuses (409) when the job is currently running or paused.
 */
export async function deleteJobById(
  projectId: string,
  featureName: string,
  jobId: string,
  jobType?: string,
): Promise<void> {
  const query = jobType ? `?type=${encodeURIComponent(jobType)}` : '';
  await apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/jobs/${encodeURIComponent(jobId)}${query}`,
  );
}

export function stopJob(
  jobId: string,
  projectId?: string,
  featureName?: string,
  jobType?: string,
): Promise<void> {
  return apiPost(
    `${API_BASE()}/jobs/${encodeURIComponent(jobId)}/stop`,
    { projectId, featureName, jobType },
  );
}

export function resumeJob(
  jobId: string,
  projectId: string,
  featureName: string,
  chatSource: boolean = true,
): Promise<{ jobId: string; originalJobId: string; jobType: 'design' | 'code' | 'learn' | 'plan' | 'visual' }> {
  return apiPost(
    `${API_BASE()}/jobs/${encodeURIComponent(jobId)}/resume`,
    { projectId, featureName, chatSource },
  );
}

export function continueJob(
  jobId: string,
  projectId: string,
  featureName: string,
  newDirective: string,
  chatSource: boolean = true,
): Promise<{ jobId: string; originalJobId: string; jobType: string; directivesCount: number }> {
  return apiPost(
    `${API_BASE()}/jobs/${encodeURIComponent(jobId)}/continue`,
    { projectId, featureName, newDirective, chatSource },
  );
}

/**
 * Send an inline ask during an interrupted job.
 * Runs triage classification: if ask intent, responds in chat; if work intent, signals continue.
 */
export function inlineAsk(
  projectId: string,
  featureName: string,
  message: string,
  chatSource: boolean = true,
): Promise<{ jobId: string; jobType: string }> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/inline-ask`,
    { message, chatSource },
  );
}

// `fetchJobStatus` was removed — it targeted a legacy `/tasks/:id/status`
// endpoint that never existed on the BE, and had zero call sites in ant-ui.
// The canonical BE endpoint is `GET /api/jobs/:id/status`, used by e2e
// helpers and ops runbooks only.

/**
 * Dismiss an interrupted (paused) job, clearing the server-side 'paused' state
 * so a new job can be started.
 */
export function dismissInterruptedJob(
  projectId: string,
  featureName: string,
  jobId: string,
): Promise<{ success: boolean }> {
  return apiPost(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/job/dismiss`,
    { jobId },
  );
}
