/**
 * Pipeline scheduling API (`/api/pipelines`) — scoped definition CRUD (user/org,
 * agents precedent), availability (enable/disable), org promote/permissions/
 * editors, per-activation runs/approvals, and the cron preview round-trip.
 * The FE NEVER parses cron locally: `previewPipelineFires` is both the "next
 * fires" display and the editor's save-gate validation leg.
 */

import { API_BASE, apiGet, apiPost, apiPut, apiDelete } from './client';
import { downloadAttachment } from './download';
import type {
  ActivePipelineInfo,
  PipelineActivation,
  PipelineActivationView,
  PipelineDef,
  PipelineListEntry,
  PipelineOrgPermissions,
  PipelinePendingApproval,
  PipelineRunSummary,
  PipelineScope,
  RunRecord,
} from '@ant/shared';

export type {
  ActivePipelineInfo,
  PipelineActivation,
  PipelineActivationView,
  PipelineDef,
  PipelineListEntry,
  PipelineOrgPermissions,
  PipelinePendingApproval,
  PipelineRunSummary,
  PipelineScope,
  RunRecord,
};

const base = () => `${API_BASE()}/pipelines`;

export function fetchPipelines(): Promise<{
  pipelines: PipelineListEntry[];
  invalid: Array<{ id: string; error: string; scope: PipelineScope }>;
  orphanActivations: PipelineActivationView[];
}> {
  return apiGet(base());
}

export interface PipelineDetail {
  id: string;
  def: PipelineDef;
  scope: PipelineScope;
  readonly: boolean;
  enabled: boolean;
  org?: PipelineOrgPermissions;
  activations: PipelineActivationView[];
}

export function fetchPipeline(pipelineId: string): Promise<PipelineDetail> {
  return apiGet(`${base()}/${encodeURIComponent(pipelineId)}`);
}

export function createPipeline(def: PipelineDef, id?: string): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPost(base(), { def, ...(id ? { id } : {}) });
}

export function updatePipeline(pipelineId: string, def: PipelineDef): Promise<{ id: string; entry: PipelineListEntry }> {
  return apiPut(`${base()}/${encodeURIComponent(pipelineId)}`, { def });
}

/** Definition folder export (ZIP) — `pipeline.yaml` + `availability.json`. */
export function downloadPipelineFolder(pipelineId: string): Promise<void> {
  return downloadAttachment(`${base()}/${encodeURIComponent(pipelineId)}/download`, `${pipelineId}.zip`);
}

export function deletePipeline(pipelineId: string): Promise<void> {
  return apiDelete(`${base()}/${encodeURIComponent(pipelineId)}`);
}

export function enablePipeline(pipelineId: string): Promise<{ id: string; enabled: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/enable`);
}

export function disablePipeline(pipelineId: string): Promise<{ id: string; enabled: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/disable`);
}

export function promotePipeline(pipelineId: string): Promise<{ id: string; scope: 'org'; owner: string }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/promote`);
}

export function fetchPipelinePermissions(pipelineId: string): Promise<PipelineOrgPermissions> {
  return apiGet(`${base()}/${encodeURIComponent(pipelineId)}/permissions`);
}

export function updatePipelineEditors(pipelineId: string, editors: string[]): Promise<PipelineOrgPermissions> {
  return apiPut(`${base()}/${encodeURIComponent(pipelineId)}/editors`, { editors });
}

export function activatePipeline(pipelineId: string, projectId: string): Promise<{ id: string; activation: PipelineActivation; nextFireAt?: string }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/activate`, { projectId });
}

export function deactivatePipeline(pipelineId: string, projectId: string): Promise<{ success: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/deactivate`, { projectId });
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

export function runPipelineNow(pipelineId: string, projectId: string): Promise<{ accepted: boolean }> {
  return apiPost(`${base()}/${encodeURIComponent(pipelineId)}/run-now`, { projectId });
}

/** Runs of ONE activation (pipeline × project); `userId` reads an org member's history read-only. */
export function fetchPipelineRuns(pipelineId: string, projectId: string, userId?: string): Promise<{ runs: PipelineRunSummary[] }> {
  const query = userId ? `&userId=${encodeURIComponent(userId)}` : '';
  return apiGet(`${base()}/${encodeURIComponent(pipelineId)}/runs?projectId=${encodeURIComponent(projectId)}${query}`);
}

export function fetchPipelineRun(runId: string, projectId?: string): Promise<{ run: Omit<RunRecord, 'defSnapshot'> }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return apiGet(`${base()}/runs/${encodeURIComponent(runId)}${query}`);
}

export function cancelPipelineRun(runId: string): Promise<{ success: boolean }> {
  return apiPost(`${base()}/runs/${encodeURIComponent(runId)}/cancel`);
}

export function fetchPipelineApprovals(): Promise<{ approvals: PipelinePendingApproval[] }> {
  return apiGet(`${base()}/approvals`);
}

export function resolvePipelineApproval(gateId: string, decision: 'approve' | 'reject'): Promise<{ success: boolean }> {
  return apiPost(`${base()}/approvals/${encodeURIComponent(gateId)}`, { decision });
}

export function answerPipelineClarify(runId: string, stepId: string, answer: string): Promise<{ success: boolean }> {
  return apiPost(`${base()}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/clarify`, { answer });
}
