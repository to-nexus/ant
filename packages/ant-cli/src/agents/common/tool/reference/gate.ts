/**
 * Discovery-driven exposure gate for the reference-codebase tools. The tools are
 * offered whenever the tenant has at least one OTHER project (so the LLM can
 * register + read it mid-job), or when a reference is already registered. The
 * register-first ordering is enforced at the handler level, not here — so all
 * four tools surface together and the handler guides misuse.
 */

import { listTenantProjects } from './catalog';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';

interface GateStateLike {
  referenceRequests?: Array<{ project: string }>;
  deps?: { workspaceResolver?: unknown };
  context?: { userId?: string; organizationId?: string; projectName?: string };
}

export async function hasReferenceSurface(state: GateStateLike): Promise<boolean> {
  if (state.referenceRequests && state.referenceRequests.length > 0) return true;
  const workspaceResolver = state.deps?.workspaceResolver as WorkspaceResolver | undefined;
  if (!workspaceResolver) return false;
  const userContext = {
    userId: state.context?.userId || 'local',
    organizationId: state.context?.organizationId || 'local',
  };
  try {
    const projects = await listTenantProjects(workspaceResolver, userContext);
    const current = state.context?.projectName;
    return projects.some((p) => p !== current);
  } catch {
    return false;
  }
}
