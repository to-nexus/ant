/**
 * Org resource ACL store (SSOT) — per-org edit authority for org-scope
 * resources, persisted at `{workspaces}/{orgId}/.ant/{kind}-acl.json`
 * (sibling of `org-config.json`, model: `userConfigStore.ts`). Two kinds
 * share one rule set: custom agents (`agent-acl.json`, key `agents`) and
 * pipelines (`pipeline-acl.json`, key `pipelines`).
 *
 * On disk (not Redis) because the definitions themselves are disk-SSOT —
 * ownership metadata lives in the same domain; only the ROLE lookup reads
 * Redis (memberships). Deliberately OUTSIDE any definition directory: the
 * definition-file write funnels confine writes to the resource's own dir,
 * so an editor can never rewrite the ACL through them — structural, not a
 * check.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Request } from 'express';
import type { CustomAgentOrgPermissions, OrgMembershipRole } from '@ant/shared';
import type { OrganizationRepositoryPort } from '../../../../../core/ports/organizationRepository';
import { hasMinRole, resolveLiveTeamMembership } from './teamRole';
import { extractUserContext } from './userContext';

export interface OrgAclEntry {
  /** Promoter userId (email) — implicit editor, not listed in `editors`. */
  owner: string;
  editors: string[];
}

type OrgAclRecords = Record<string, OrgAclEntry>;

function aclPath(workspacesPath: string, orgId: string, fileName: string): string {
  return path.join(workspacesPath, orgId, '.ant', fileName);
}

/** Missing or corrupt file reads as empty records (admin-only editing). */
async function readAclRecords(
  workspacesPath: string,
  orgId: string,
  fileName: string,
  recordKey: string,
): Promise<OrgAclRecords> {
  try {
    const raw = await fs.promises.readFile(aclPath(workspacesPath, orgId, fileName), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const records = parsed?.[recordKey];
    if (!records || typeof records !== 'object' || Array.isArray(records)) return {};
    return records as OrgAclRecords;
  } catch {
    return {};
  }
}

async function updateAclRecords(
  workspacesPath: string,
  orgId: string,
  fileName: string,
  recordKey: string,
  mutate: (records: OrgAclRecords) => void,
): Promise<OrgAclRecords> {
  const records = await readAclRecords(workspacesPath, orgId, fileName, recordKey);
  mutate(records);
  const target = aclPath(workspacesPath, orgId, fileName);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, JSON.stringify({ version: 1, [recordKey]: records }, null, 2), 'utf-8');
  return records;
}

/**
 * Edit authority for one org resource. A null live role (removed member /
 * stale JWT) is always a refusal — even for the recorded owner. A missing
 * entry (pre-ACL resource, orphan cleanup) leaves editing to org admins only.
 */
export function canEditOrgResource(
  entry: OrgAclEntry | undefined,
  callerId: string,
  liveRole: OrgMembershipRole | null,
): boolean {
  if (!liveRole) return false;
  if (hasMinRole(liveRole, 'admin')) return true;
  if (!entry) return false;
  return entry.owner === callerId || entry.editors.includes(callerId);
}

/** Caller-specific permission projection for one org resource (BE↔FE shape). */
export function computeOrgResourcePermissions(
  entry: OrgAclEntry | undefined,
  callerId: string,
  liveRole: OrgMembershipRole | null,
): CustomAgentOrgPermissions {
  const canEdit = canEditOrgResource(entry, callerId, liveRole);
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

/**
 * The org write-gate every route funnel judges ACL-governed writes against —
 * live team role + this resource kind's ACL records.
 */
export interface OrgResourceGate {
  callerId: string;
  liveRole: OrgMembershipRole | null;
  records: OrgAclRecords;
}

/**
 * Request-memoized org write-gate resolver — live team role + org ACL,
 * fetched at most once per request and only when an ACL-governed resource is
 * actually being touched (the funnels invoke it lazily).
 */
export function createOrgGateResolver(
  deps: { organizationRepository: OrganizationRepositoryPort; workspacesPath: string },
  readRecords: (workspacesPath: string, orgId: string) => Promise<OrgAclRecords>,
): (req: Request) => () => Promise<OrgResourceGate> {
  return (req: Request) => {
    let cached: Promise<OrgResourceGate> | null = null;
    return () => {
      cached ??= (async () => {
        const userContext = extractUserContext(req);
        const resolved =
          userContext.organizationKind === 'team'
            ? await resolveLiveTeamMembership(
                deps.organizationRepository,
                userContext.userId,
                userContext.organizationId,
              )
            : null;
        return {
          callerId: userContext.userId,
          liveRole: resolved?.membership.role ?? null,
          records: await readRecords(deps.workspacesPath, userContext.organizationId),
        };
      })();
      return cached;
    };
  };
}

// ── agents (agent-acl.json, key "agents") ─────────────────────────────────

export function getOrgAgentAclPath(workspacesPath: string, orgId: string): string {
  return aclPath(workspacesPath, orgId, 'agent-acl.json');
}

export function readOrgAgentAcl(workspacesPath: string, orgId: string): Promise<OrgAclRecords> {
  return readAclRecords(workspacesPath, orgId, 'agent-acl.json', 'agents');
}

export function updateOrgAgentAcl(
  workspacesPath: string,
  orgId: string,
  mutate: (records: OrgAclRecords) => void,
): Promise<OrgAclRecords> {
  return updateAclRecords(workspacesPath, orgId, 'agent-acl.json', 'agents', mutate);
}

// ── pipelines (pipeline-acl.json, key "pipelines") ────────────────────────

export function getOrgPipelineAclPath(workspacesPath: string, orgId: string): string {
  return aclPath(workspacesPath, orgId, 'pipeline-acl.json');
}

export function readOrgPipelineAcl(workspacesPath: string, orgId: string): Promise<OrgAclRecords> {
  return readAclRecords(workspacesPath, orgId, 'pipeline-acl.json', 'pipelines');
}

export function updateOrgPipelineAcl(
  workspacesPath: string,
  orgId: string,
  mutate: (records: OrgAclRecords) => void,
): Promise<OrgAclRecords> {
  return updateAclRecords(workspacesPath, orgId, 'pipeline-acl.json', 'pipelines', mutate);
}
