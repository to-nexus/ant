/**
 * Shared context for the account-agents route modules — scope-root resolution
 * from the ACCOUNT (never a projectId), the org-ACL gate, and the structural
 * path helpers.
 */

import { Request, Response } from 'express';
import { isValidCustomId } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { deriveCustomAgentScopeRootsForTenant } from '../../../../../core/customAgents/scopeRoots';
import type { OrganizationRepositoryPort } from '../../../../../core/ports/organizationRepository';
import { findAgentRoot, type CustomAgentScopeRoot } from '../../../../../core/customAgents/CustomAgentLoader';
import { createOrgGateResolver, readOrgAgentAcl } from '../helpers/orgAclStore';
import { extractUserContext } from '../helpers/userContext';
import type { StateStorePort } from '../../../../../core/ports/stateStore';

export interface AccountAgentsRoutesDeps {
  workspaceResolver: WorkspaceResolver;
  organizationRepository: OrganizationRepositoryPort;
  /** Backs the cluster-wide per-account budget on the folder-export stream. */
  stateStore?: StateStorePort;
}

/**
 * Files the settings UI may never delete/rename directly — remove the
 * agent/job/intent directory instead. `intents/{id}/infer.md` is included:
 * deleting or renaming it alone always breaks the required-file invariant
 * (the sibling prompt.md and hooks.yaml are optional and stay freely
 * deletable).
 */
export function isStructuralFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized === 'agent.yaml' ||
    /^jobs\/[^/]+\/job\.yaml$/.test(normalized) ||
    /^jobs\/[^/]+\/intents\/[^/]+\/infer\.md$/.test(normalized)
  );
}

/** `jobs/{jobId}/intents/{intentId}` (the intent DIRECTORY), or null. */
export function parseIntentDirPath(relPath: string): { jobId: string; intentId: string } | null {
  const parts = relPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (parts.length !== 4 || parts[0] !== 'jobs' || parts[2] !== 'intents') return null;
  if (!isValidCustomId(parts[1]) || !isValidCustomId(parts[3])) return null;
  return { jobId: parts[1], intentId: parts[3] };
}

export type AccountAgentsRouteContext = ReturnType<typeof buildAccountAgentsRouteContext>;

export function buildAccountAgentsRouteContext(deps: AccountAgentsRoutesDeps) {
  function scopeRootsFor(req: Request): CustomAgentScopeRoot[] {
    const userContext = extractUserContext(req);
    return deriveCustomAgentScopeRootsForTenant({
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
      userId: userContext.userId,
      organizationId: userContext.organizationId,
      organizationKind: userContext.organizationKind ?? 'local',
    });
  }

  const orgGateFor = createOrgGateResolver(
    {
      organizationRepository: deps.organizationRepository,
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
    },
    readOrgAgentAcl,
  );

  /** The creation/import destination — the writable user root. */
  function creationRoot(scopeRoots: CustomAgentScopeRoot[]): CustomAgentScopeRoot {
    return scopeRoots.find((r) => r.scope === 'user' && !r.readonly)!;
  }

  /** Any-scope resolve (readonly scopes are viewable) or 400/404 response. */
  function findViewableAgent(
    res: Response,
    scopeRoots: CustomAgentScopeRoot[],
    agentId: string,
  ): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
    if (!isValidCustomId(agentId)) {
      res.status(400).json({ error: `Invalid agent id: ${agentId}` });
      return null;
    }
    const found = findAgentRoot(scopeRoots, agentId);
    if (!found) {
      res.status(404).json({ error: `Custom agent not found: ${agentId}` });
      return null;
    }
    return found;
  }

  return { deps, scopeRootsFor, orgGateFor, creationRoot, findViewableAgent };
}
