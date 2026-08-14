/**
 * Org-agent ACL store (SSOT) — per-org edit authority for promoted (org-scope)
 * custom agents, persisted at `{workspaces}/{orgId}/.ant/agent-acl.json`
 * (sibling of `org-config.json`, model: `userConfigStore.ts`).
 *
 * On disk (not Redis) because the agent definitions themselves are disk-SSOT —
 * ownership metadata lives in the same domain; only the ROLE lookup reads
 * Redis (memberships). Deliberately OUTSIDE any agent definition directory:
 * the definition-file PUT API confines writes to `agents/{agentId}/`
 * (`resolveDefinitionPath`), so an editor can never rewrite the ACL through
 * that funnel — structural, not a check.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CustomAgentOrgPermissions, OrgMembershipRole } from '@ant/shared';
import { hasMinRole } from './teamRole';

export interface OrgAgentAclEntry {
  /** Promoter userId (email) — implicit editor, not listed in `editors`. */
  owner: string;
  editors: string[];
}

export interface OrgAgentAcl {
  version: 1;
  agents: Record<string, OrgAgentAclEntry>;
}

const EMPTY_ACL: OrgAgentAcl = { version: 1, agents: {} };

export function getOrgAgentAclPath(workspacesPath: string, orgId: string): string {
  return path.join(workspacesPath, orgId, '.ant', 'agent-acl.json');
}

/** Missing or corrupt file reads as an empty ACL (admin-only editing). */
export async function readOrgAgentAcl(workspacesPath: string, orgId: string): Promise<OrgAgentAcl> {
  try {
    const raw = await fs.promises.readFile(getOrgAgentAclPath(workspacesPath, orgId), 'utf-8');
    const parsed = JSON.parse(raw) as OrgAgentAcl;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.agents !== 'object' || !parsed.agents) {
      return { version: 1, agents: {} };
    }
    return { version: 1, agents: parsed.agents };
  } catch {
    return { ...EMPTY_ACL, agents: {} };
  }
}

export async function updateOrgAgentAcl(
  workspacesPath: string,
  orgId: string,
  mutate: (acl: OrgAgentAcl) => void,
): Promise<OrgAgentAcl> {
  const acl = await readOrgAgentAcl(workspacesPath, orgId);
  mutate(acl);
  const aclPath = getOrgAgentAclPath(workspacesPath, orgId);
  await fs.promises.mkdir(path.dirname(aclPath), { recursive: true });
  await fs.promises.writeFile(aclPath, JSON.stringify(acl, null, 2), 'utf-8');
  return acl;
}

/**
 * Edit authority for one org agent. A null live role (removed member / stale
 * JWT) is always a refusal — even for the recorded owner. A missing entry
 * (pre-ACL agent, orphan cleanup) leaves editing to org admins only.
 */
export function canEditOrgAgent(
  entry: OrgAgentAclEntry | undefined,
  callerId: string,
  liveRole: OrgMembershipRole | null,
): boolean {
  if (!liveRole) return false;
  if (hasMinRole(liveRole, 'admin')) return true;
  if (!entry) return false;
  return entry.owner === callerId || entry.editors.includes(callerId);
}

/** Caller-specific permission projection for one org agent (BE↔FE shape). */
export function computeOrgAgentPermissions(
  entry: OrgAgentAclEntry | undefined,
  callerId: string,
  liveRole: OrgMembershipRole | null,
): CustomAgentOrgPermissions {
  const canEdit = canEditOrgAgent(entry, callerId, liveRole);
  const canManageEditors =
    !!liveRole && (hasMinRole(liveRole, 'admin') || entry?.owner === callerId);
  return {
    ...(entry?.owner ? { owner: entry.owner } : {}),
    canEdit,
    canManageEditors,
    // Editors are surfaced only to callers who may manage them.
    ...(canManageEditors ? { editors: entry?.editors ?? [] } : {}),
  };
}
