/**
 * Pipeline definition scope roots — the agents model (`customAgents/scopeRoots`)
 * minus builtin and the env escape hatch: pipelines ship no samples and have
 * no self-host global dir. Ordered by priority (user > org); discovery merges
 * closest-wins on id collision, and the ACL for the org root lives at
 * `{ws}/{orgId}/.ant/pipeline-acl.json` (sibling of `pipelines/`, so the
 * definition write funnel can never reach it).
 */

import * as path from 'path';
import type { PipelineScope } from '@ant/shared';
import { resolveTenantUserDir } from '../config/tenantAnchor.js';
import { derivePipelinesRoot, PIPELINES_DIRNAME, type PipelineTenantContext } from './paths.js';

export interface PipelineScopeRoot {
  scope: PipelineScope;
  root: string;
  readonly: boolean;
  /** Writes gated per-pipeline by the org ACL, not by the root flag. */
  aclGoverned?: boolean;
}

export function derivePipelineScopeRootsForTenant(ctx: PipelineTenantContext): PipelineScopeRoot[] {
  const roots: PipelineScopeRoot[] = [
    { scope: 'user', root: path.join(resolveTenantUserDir(ctx), PIPELINES_DIRNAME), readonly: false },
  ];
  if (ctx.organizationKind === 'team') {
    roots.push({
      scope: 'org',
      root: path.join(ctx.workspacesPath, ctx.organizationId, PIPELINES_DIRNAME),
      readonly: false,
      aclGoverned: true,
    });
  }
  return roots;
}

/** Definitions root for a PINNED scope — the fire path never falls back across scopes. */
export function resolveDefRoot(ctx: PipelineTenantContext, scope: PipelineScope): string {
  if (scope === 'org') {
    return path.join(ctx.workspacesPath, ctx.organizationId, PIPELINES_DIRNAME);
  }
  return derivePipelinesRoot(ctx);
}
