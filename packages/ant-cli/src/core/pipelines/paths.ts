/**
 * Pipeline disk layout — two disjoint trees, both SSOT:
 *
 * DEFINITIONS live under scope roots (agents precedent — see `scopeRoots.ts`):
 *   {defRoot}/{pipelineId}/pipeline.yaml
 *   {defRoot}/{pipelineId}/owner.json          ← authorship coords (never the fire identity)
 *   {defRoot}/{pipelineId}/availability.json   ← enabled/disabled state machine
 *
 * ACTIVATIONS live in the ACTIVATOR's account, anchored at the ACTIVE org
 * context (NO INDIVIDUAL fork — projectIds are only unique per {org}/{user},
 * and the activation binds a project):
 *   {ws}/{organizationId}/{userId}/.ant/pipeline-activations/{projectId}/activation.json
 *   {ws}/{organizationId}/{userId}/.ant/pipeline-activations/{projectId}/runs/{runId}.jsonl
 *   {ws}/{organizationId}/{userId}/.ant/pipeline-activations/{projectId}/runs/index.jsonl
 *
 * Runs colocate with the activation and SURVIVE deactivation (deactivate
 * removes only activation.json).
 */

import * as path from 'path';
import { PIPELINE_ACTIVATION_FILE_NAME, PIPELINE_AVAILABILITY_FILE_NAME } from '@ant/shared';
import { resolveTenantUserDir, type TenantAnchorContext } from '../config/tenantAnchor.js';

export const PIPELINES_DIRNAME = '.ant/pipelines';
export const PIPELINE_ACTIVATIONS_DIRNAME = '.ant/pipeline-activations';

export type PipelineTenantContext = TenantAnchorContext;

/**
 * The caller's PERSONAL definitions root (creation target). Team orgs anchor
 * under the INDIVIDUAL org — same fork as agents, via `resolveTenantUserDir`.
 */
export function derivePipelinesRoot(ctx: PipelineTenantContext): string {
  return path.join(resolveTenantUserDir(ctx), PIPELINES_DIRNAME);
}

/** The activator's activations root — ACTIVE org context, no INDIVIDUAL fork. */
export function deriveActivationsRoot(ctx: PipelineTenantContext): string {
  return path.join(ctx.workspacesPath, ctx.organizationId, ctx.userId, PIPELINE_ACTIVATIONS_DIRNAME);
}

// ---- definition tree ----

export function pipelineDir(root: string, pipelineId: string): string {
  return path.join(root, pipelineId);
}

export function pipelineDefPath(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, 'pipeline.yaml');
}

export function pipelineAvailabilityPath(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, PIPELINE_AVAILABILITY_FILE_NAME);
}

// ---- activation tree (projectId-keyed) ----

export function activationDir(actRoot: string, projectId: string): string {
  return path.join(actRoot, projectId);
}

export function activationFilePath(actRoot: string, projectId: string): string {
  return path.join(actRoot, projectId, PIPELINE_ACTIVATION_FILE_NAME);
}

export function activationRunsDir(actRoot: string, projectId: string): string {
  return path.join(actRoot, projectId, 'runs');
}

export function activationRunLogPath(actRoot: string, projectId: string, runId: string): string {
  return path.join(actRoot, projectId, 'runs', `${runId}.jsonl`);
}

export function activationRunIndexPath(actRoot: string, projectId: string): string {
  return path.join(actRoot, projectId, 'runs', 'index.jsonl');
}
