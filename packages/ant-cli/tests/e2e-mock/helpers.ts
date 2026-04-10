const API = process.env.ANT_E2E_API_URL || 'http://localhost:4100';
const DEFAULT_TIMEOUT = parseInt(process.env.ANT_E2E_TIMEOUT || '60000');
const POLL_INTERVAL = 3000;

export const PROJECT_ID = 'probe';
export const FEATURE_NAME = 'e2e-test';

export async function api(path: string, options?: RequestInit) {
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
}

export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureProjectAndFeature(feature?: string): Promise<void> {
  await api(`/api/projects`, {
    method: 'POST',
    body: JSON.stringify({ id: PROJECT_ID }),
  });

  await api(`/api/projects/${PROJECT_ID}/features`, {
    method: 'POST',
    body: JSON.stringify({ featureName: feature || FEATURE_NAME, language: 'typescript' }),
  });
}

export interface EnqueueOptions {
  jobType: string;
  agent?: string;
  directive: string;
  actionMetadata?: Record<string, any>;
  feature?: string;
}

export async function enqueueJob(opts: EnqueueOptions): Promise<string> {
  const feature = opts.feature || FEATURE_NAME;
  const res = await api(`/api/projects/${PROJECT_ID}/features/${feature}/execute`, {
    method: 'POST',
    body: JSON.stringify({
      task: opts.jobType,
      agent: opts.agent || 'architect',
      chatSource: true,
      overrideDirective: opts.directive,
      actionMetadata: opts.actionMetadata,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enqueue failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.jobId) throw new Error(`No jobId in response: ${JSON.stringify(data)}`);
  return data.jobId;
}

export interface JobResult {
  status: string;
  error?: string;
  raw?: any;
}

export async function pollUntilDone(
  jobId: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<JobResult> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await api(`/api/jobs/${jobId}/status`);
      if (!res.ok) {
        return { status: 'error', error: `Status API returned ${res.status}` };
      }

      const data = await res.json();
      const status = data.status || data.state;

      if (status === 'completed') {
        return { status: 'completed', raw: data };
      }
      if (status === 'failed') {
        return { status: 'failed', error: data.error || data.message || 'Unknown failure', raw: data };
      }
    } catch (err: any) {
      return { status: 'error', error: err.message };
    }

    await sleep(POLL_INTERVAL);
  }

  return { status: 'timeout', error: `Job ${jobId} did not complete within ${timeout}ms` };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
