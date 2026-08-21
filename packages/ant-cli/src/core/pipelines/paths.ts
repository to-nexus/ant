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
import { assertPathSegment } from '../config/pathContainment.js';

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

/**
 * The activator's activations root — ACTIVE org context, no INDIVIDUAL fork.
 *
 * `organizationId`/`userId` are single-segment-validated before the join: the
 * team run-history route lets a caller name a *target* userId, so this is the
 * final boundary that stops a `../` identifier from re-anchoring the root at
 * another tenant's tree (H-016, M-025). Legitimate ids (incl. email userIds)
 * carry no separator and pass unchanged.
 */
export function deriveActivationsRoot(ctx: PipelineTenantContext): string {
  return path.join(
    ctx.workspacesPath,
    assertPathSegment('organizationId', ctx.organizationId),
    assertPathSegment('userId', ctx.userId),
    PIPELINE_ACTIVATIONS_DIRNAME,
  );
}

// ---- definition tree ----

export function pipelineDir(root: string, pipelineId: string): string {
  return path.join(root, assertPathSegment('pipelineId', pipelineId));
}

export function pipelineDefPath(root: string, pipelineId: string): string {
  return path.join(root, assertPathSegment('pipelineId', pipelineId), 'pipeline.yaml');
}

export function pipelineAvailabilityPath(root: string, pipelineId: string): string {
  return path.join(root, assertPathSegment('pipelineId', pipelineId), PIPELINE_AVAILABILITY_FILE_NAME);
}

// ---- activation tree (projectId-keyed) ----
//
// Every helper single-segment-validates its caller-supplied identifier before
// `path.join`. This helper layer is the final boundary shared by the HTTP
// routes, the reconciler, the run coordinator and the delete/rename cascade —
// so a traversal id is rejected no matter which caller reaches disk (H-016).

export function activationDir(actRoot: string, projectId: string): string {
  return path.join(actRoot, assertPathSegment('projectId', projectId));
}

export function activationFilePath(actRoot: string, projectId: string): string {
  return path.join(actRoot, assertPathSegment('projectId', projectId), PIPELINE_ACTIVATION_FILE_NAME);
}

export function activationRunsDir(actRoot: string, projectId: string): string {
  return path.join(actRoot, assertPathSegment('projectId', projectId), 'runs');
}

export function activationRunLogPath(actRoot: string, projectId: string, runId: string): string {
  return path.join(
    actRoot,
    assertPathSegment('projectId', projectId),
    'runs',
    `${assertPathSegment('runId', runId)}.jsonl`,
  );
}

export function activationRunIndexPath(actRoot: string, projectId: string): string {
  return path.join(actRoot, assertPathSegment('projectId', projectId), 'runs', 'index.jsonl');
}
