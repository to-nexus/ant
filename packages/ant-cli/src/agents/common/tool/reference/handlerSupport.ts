/**
 * Shared plumbing for the reference-codebase tool handlers.
 */

import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../core/types/user';
import type { ToolExecutionContext } from '../types';

export interface RefDeps {
  workspaceResolver: WorkspaceResolver;
  userContext: UserContext;
}

/** Resolve the workspaceResolver + tenant userContext from a tool ctx, or an error string. */
export function getRefDeps(ctx: ToolExecutionContext): RefDeps | { error: string } {
  const workspaceResolver = ctx.workspaceResolver as WorkspaceResolver | undefined;
  if (!workspaceResolver) {
    return { error: 'Reference tools unavailable: workspaceResolver not wired into this job.' };
  }
  const userContext: UserContext = {
    userId: ctx.userId || 'local',
    organizationId: ctx.organizationId || 'local',
  };
  return { workspaceResolver, userContext };
}

/** True when `project` is already registered as a reference for this job. */
export function isRegistered(ctx: ToolExecutionContext, project: string): boolean {
  return (ctx.referenceRequests || []).some((r: any) => r?.project === project);
}

/** Error shown when a read/list/search targets an unregistered project. */
export function notRegisteredError(project: string, ctx: ToolExecutionContext): string {
  const registered = (ctx.referenceRequests || []).map((r: any) => r?.project).filter(Boolean);
  return (
    `Reference project "${project}" is not registered. ` +
    `Call register_reference({ project: "${project}" }) first, then read/list/search it. ` +
    `Currently registered: ${registered.length ? registered.join(', ') : '(none)'}`
  );
}
