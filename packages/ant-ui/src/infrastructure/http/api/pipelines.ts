/**
 * Pipeline scheduling API (`/api/projects/:projectId/pipelines`) — CRUD over
 * the account-scoped disk SSOT, run history, approvals, and the cron preview
 * round-trip. The FE NEVER parses cron locally: `previewPipelineFires` is
 * both the "next fires" display and the editor's save-gate validation leg.
 */

import { API_BASE, apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client';
import type {
  PipelineDef,
  PipelineListEntry,
  PipelinePendingApproval,
  PipelineRunSummary,
  RunRecord,
} from '@ant/shared';

export type { PipelineDef, PipelineListEntry, PipelinePendingApproval, PipelineRunSummary, RunRecord };

const base = (projectId: string) => `${API_BASE()}/projects/${encodeURIComponent(projectId)}/pipelines`;

export function fetchPipelines(projectId: string): Promise<{
  pipelines: PipelineListEntry[];
  invalid: Array<{ id: string; error: string }>;
}> {
  return apiGet(base(projectId));
}

export function fetchPipeline(projectId: string, pipelineId: string): Promise<{ id: string; def: PipelineDef }> {
  return apiGet(`${base(projectId)}/${encodeURIComponent(pipelineId)}`);
}

export function createPipeline(projectId: string, def: PipelineDef, id?: string): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPost(base(projectId), { def, ...(id ? { id } : {}) });
}

export function updatePipeline(projectId: string, pipelineId: string, def: PipelineDef): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPut(`${base(projectId)}/${encodeURIComponent(pipelineId)}`, { def });
}

export function setPipelineEnabled(projectId: string, pipelineId: string, enabled: boolean): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPatch(`${base(projectId)}/${encodeURIComponent(pipelineId)}`, { enabled });
}

export function deletePipeline(projectId: string, pipelineId: string): Promise<void> {
  return apiDelete(`${base(projectId)}/${encodeURIComponent(pipelineId)}`);
}

export function previewPipelineFires(projectId: string, cron: string, tz?: string): Promise<{ ok: boolean; error?: string; fires: string[] }> {
  return apiPost(`${base(projectId)}/preview-fires`, { cron, tz });
}

export function runPipelineNow(projectId: string, pipelineId: string): Promise<{ accepted: boolean }> {
  return apiPost(`${base(projectId)}/${encodeURIComponent(pipelineId)}/run-now`);
}

export function fetchPipelineRuns(projectId: string, pipelineId: string): Promise<{ runs: PipelineRunSummary[] }> {
  return apiGet(`${base(projectId)}/${encodeURIComponent(pipelineId)}/runs`);
}

export function fetchPipelineRun(projectId: string, runId: string, pipelineId?: string): Promise<{ run: Omit<RunRecord, 'defSnapshot'> }> {
  const query = pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : '';
  return apiGet(`${base(projectId)}/runs/${encodeURIComponent(runId)}${query}`);
}

export function cancelPipelineRun(projectId: string, runId: string, pipelineId: string): Promise<{ success: boolean }> {
  return apiPost(`${base(projectId)}/runs/${encodeURIComponent(runId)}/cancel`, { pipelineId });
}

export function fetchPipelineApprovals(projectId: string): Promise<{ approvals: PipelinePendingApproval[] }> {
  return apiGet(`${base(projectId)}/approvals`);
}

export function resolvePipelineApproval(projectId: string, gateId: string, decision: 'approve' | 'reject'): Promise<{ success: boolean }> {
  return apiPost(`${base(projectId)}/approvals/${encodeURIComponent(gateId)}`, { decision });
}
