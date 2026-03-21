import { API_BASE, authFetch, apiGet, apiPost, apiDelete } from './client';

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
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

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
  } = params;

  if (!featureName) {
    throw new Error('Feature name is required for job execution');
  }

  const requestBody = { task, agent, mode, language, overrideDirective, chatSource, skipTriage };
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

export async function clearSessionData(
  projectId: string,
  featureName: string,
  jobType: string,
): Promise<void> {
  await apiDelete(
    `${API_BASE()}/projects/${projectId}/features/${featureName}/session?job=${jobType}`,
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
): Promise<{ jobId: string; originalJobId: string; jobType: string }> {
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

export function fetchJobStatus(jobId: string): Promise<JobStatus> {
  return apiGet(`${API_BASE()}/tasks/${encodeURIComponent(jobId)}/status`);
}

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
