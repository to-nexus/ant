/**
 * Pipeline definition paths — account-scoped disk SSOT, sibling of
 * `.ant/agents` (scopeRoots precedent). v1 serves the USER scope only:
 * pipelines chain jobs across agents, and owner delegation (D6) makes the
 * owner's account root the natural anchor. No org/builtin pipeline roots —
 * adding one later is "one more root", not a mechanism change.
 *
 * Layout:
 *   {userDir}/.ant/pipelines/{pipelineId}/pipeline.yaml
 *   {userDir}/.ant/pipelines/{pipelineId}/activation.json   ← project binding (absence = deactivated)
 *   {userDir}/.ant/pipelines/{pipelineId}/runs/{runId}.jsonl
 *   {userDir}/.ant/pipelines/{pipelineId}/runs/index.jsonl
 */

import * as path from 'path';
import { INDIVIDUAL_ORG_ID, PIPELINE_ACTIVATION_FILE_NAME, type OrganizationKind } from '@ant/shared';

export const PIPELINES_DIRNAME = '.ant/pipelines';

export interface PipelineTenantContext {
  /** Physical workspaces root (`ANT_WORKSPACE_BASE_PATH` resolution). */
  workspacesPath: string;
  userId: string;
  organizationId: string;
  organizationKind: OrganizationKind;
}

/**
 * The owner's pipelines container dir. Team orgs anchor personal data under
 * the INDIVIDUAL org — same fork as `deriveCustomAgentScopeRootsForTenant`,
 * so switching the active org never re-homes a pipeline.
 */
export function derivePipelinesRoot(ctx: PipelineTenantContext): string {
  const userDir =
    ctx.organizationKind === 'team'
      ? path.join(ctx.workspacesPath, INDIVIDUAL_ORG_ID, ctx.userId)
      : path.join(ctx.workspacesPath, ctx.organizationId, ctx.userId);
  return path.join(userDir, PIPELINES_DIRNAME);
}

export function pipelineDir(root: string, pipelineId: string): string {
  return path.join(root, pipelineId);
}

export function pipelineDefPath(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, 'pipeline.yaml');
}

export function pipelineActivationPath(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, PIPELINE_ACTIVATION_FILE_NAME);
}

export function pipelineRunsDir(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, 'runs');
}

export function pipelineRunLogPath(root: string, pipelineId: string, runId: string): string {
  return path.join(root, pipelineId, 'runs', `${runId}.jsonl`);
}

export function pipelineRunIndexPath(root: string, pipelineId: string): string {
  return path.join(root, pipelineId, 'runs', 'index.jsonl');
}
