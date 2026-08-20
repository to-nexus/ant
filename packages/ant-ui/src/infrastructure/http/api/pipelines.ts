/**
 * Pipeline scheduling API (`/api/pipelines`) — ACCOUNT-scoped CRUD over the
 * disk SSOT, run history, approvals, activation (the pipeline↔project
 * binding), and the cron preview round-trip. The FE NEVER parses cron
 * locally: `previewPipelineFires` is both the "next fires" display and the
 * editor's save-gate validation leg.
 */

import { API_BASE, apiGet, apiPost, apiPut, apiDelete } from './client';
import type {
  ActivePipelineInfo,
  PipelineActivation,
  PipelineDef,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  RunRecord,
} from '@ant/shared';

export type {
  ActivePipelineInfo,
  PipelineActivation,
  PipelineDef,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  RunRecord,
};

const base = () => `${API_BASE()}/pipelines`;

export function fetchPipelines(): Promise<{
  pipelines: PipelineListEntry[];
  invalid: Array<{ id: string; error: string }>;
}> {
  return apiGet(base());
}

export function fetchPipeline(pipelineId: string): Promise<{ id: string; def: PipelineDef; activation: PipelineActivation | null }> {
  return apiGet(`${base()}/${encodeURIComponent(pipelineId)}`);
}

export function createPipeline(def: PipelineDef, id?: string): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPost(base(), { def, ...(id ? { id } : {}) });
}

export function updatePipeline(pipelineId: string, def: PipelineDef): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPut(`${base()}/${encodeURIComponent(pipelineId)}`, { def });
}

export function deletePipeline(pipelineId: string): Promise<void> {
  return apiDelete(`${base()}/${encodeURIComponent(pipelineId)}`);
}

export function activatePipeline(pipelineId: string, projectId: string): Promise<{ id: string; activation: PipelineActivation; nextFireAt?: string }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/activate`, { projectId });
}

export function deactivatePipeline(pipelineId: string): Promise<{ success: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/deactivate`);
}

export function fetchActivatableProjects(): Promise<{ projects: Array<{ id: string; name: string; activePipelineId: string | null }> }> {
  return apiGet(`${base()}/activatable-projects`);
}

export function fetchActivePipeline(projectId: string): Promise<{ active: ActivePipelineInfo | null }> {
  return apiGet(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/active-pipeline`);
}

export function previewPipelineFires(cron: string, tz?: string): Promise<{ ok: boolean; error?: string; fires: string[] }> {
  return apiPost(`${base()}/preview-fires`, { cron, tz });
}

export function runPipelineNow(pipelineId: string): Promise<{ accepted: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/run-now`);
}

export function fetchPipelineRuns(pipelineId: string): Promise<{ runs: PipelineRunSummary[] }> {
  return apiGet(`${base()}/${encodeURIComponent(pipelineId)}/runs`);
}

export function fetchPipelineRun(runId: string, pipelineId?: string): Promise<{ run: Omit<RunRecord, 'defSnapshot'> }> {
  const query = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : '';
  return apiGet(`${base()}/runs/${encodeURIComponent(runId)}${query}`);
}

export function cancelPipelineRun(runId: string, pipelineId: string): Promise<{ success: boolean }> {
  return apiPost(`${base()}/runs/${encodeURIComponent(runId)}/cancel`, { pipelineId });
}

export function fetchPipelineApprovals(): Promise<{ approvals: PipelinePendingApproval[] }> {
  return apiGet(`${base()}/approvals`);
}

export function resolvePipelineApproval(gateId: string, decision: 'approve' | 'reject'): Promise<{ success: boolean }> {
  return apiPost(`${base()}/approvals/${encodeURIComponent(gateId)}`, { decision });
}
