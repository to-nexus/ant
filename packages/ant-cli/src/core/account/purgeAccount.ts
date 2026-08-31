/**
 * Account purge — the single owner of "destroy everything this identity owns".
 *
 * Two callers, one engine: the super-admin purge
 * (`DELETE /api/admin/users/:userId`) and the caller's own reset
 * (`POST /api/user/reset`, which passes `mode: 'data-only'`). A third caller,
 * self-serve withdrawal, is the same call with `reason: 'self-withdrawal'`.
 *
 * Three properties this engine exists to guarantee, each of which a previous
 * ad-hoc path got wrong:
 *
 *  1. Projects go through `ProjectService.deleteProject`, never a bare `fs.rm`.
 *     That is what cancels jobs, drops pipeline activations, tears down IDE
 *     pods, acks the preview process and sweeps Redis. Skipping it leaks EFS
 *     handles and leaves stale workers.
 *  2. The scope set includes `individual` unconditionally. `resolveTenantUserDir`
 *     anchors a TEAM member's personal data (credentials, agents, pipelines)
 *     under `{ws}/individual/{user}` — sweeping only the membership orgs leaves
 *     the encrypted credential store on disk.
 *  3. The identity leaves a tombstone rather than a hole. `getUserApproval`
 *     answers `approved` for a MISSING record, and JWTs are stateless with no
 *     denylist, so a plain delete would leave a live cookie working for days
 *     and a desktop token for 90.
 *
 * Steps report rather than throw: one wedged project must not leave a
 * half-purged account with no record of what remains.
 */

import * as fs from 'fs';
import * as path from 'path';
import { INDIVIDUAL_ORG_ID, deriveKindFromOrgId } from '@ant/shared';
import type { OrganizationRepositoryPort, UserPurgeReason } from '../ports/organizationRepository';
import type { CreditLedgerPort } from '../ports/creditLedger';
import type { StateStorePort } from '../ports/stateStore';
import type { UserContext } from '../types/user';
import { resolveTenantUserDir } from '../config/tenantAnchor';
import { logger } from '../../utils/logger';

/** Ordered so a report reads as a narrative of what the purge did. */
export type PurgeStep =
  | 'projects'
  | 'userFiles'
  | 'redisState'
  | 'memberships'
  | 'orgAcls'
  | 'identity';

export interface PurgeStepResult {
  step: PurgeStep;
  ok: boolean;
  /** Human-readable count for the admin report ("3 projects", "2 orgs"). */
  detail?: string;
  error?: string;
}

export interface PurgeReport {
  userId: string;
  /** Every (orgId) the purge acted on — memberships ∪ ledger scopes ∪ individual. */
  scopes: string[];
  steps: PurgeStepResult[];
  /** False when any step failed; the caller surfaces the per-step detail. */
  ok: boolean;
}

export interface PurgeAccountDeps {
  organizationRepository: OrganizationRepositoryPort;
  creditLedger: CreditLedgerPort;
  stateStore?: StateStorePort;
  /** Physical workspaces root (`WorkspacePathResolver.getPhysicalWorkspacesPath()`). */
  workspacesPath: string;
  projectService: {
    listProjects(userContext: UserContext): Promise<string[]>;
    deleteProject(id: string, userContext: UserContext, opts?: { force?: boolean }): Promise<void>;
  };
}

export interface PurgeAccountInput {
  userId: string;
  purgedBy: string;
  reason: UserPurgeReason;
  /**
   * `full` also detaches memberships and tombstones the identity.
   * `data-only` stops after the workspace + Redis sweep — the account keeps
   * working, which is what `POST /api/user/reset` means.
   */
  mode: 'full' | 'data-only';
}

/** Files under `{userDir}/.ant` that belong to the person, not to the org. */
const PERSONAL_ANT_ENTRIES = [
  'agents',
  'pipelines',
  'pipeline-activations',
  'credentials.json',
  'encryption.key',
  'integrations.json',
  'preferences.json',
];

/**
 * Every org the purge must sweep. `individual` is unconditional: a team-only
 * member still has personal data anchored there (`resolveTenantUserDir`), and a
 * ledger account can outlive the membership that created it.
 */
export async function resolvePurgeScopes(
  deps: Pick<PurgeAccountDeps, 'organizationRepository' | 'creditLedger'>,
  userId: string,
): Promise<string[]> {
  const [memberships, ledgerScopes] = await Promise.all([
    deps.organizationRepository.listMembershipsByUser(userId),
    deps.creditLedger.listAccountScopes(userId).catch(() => [] as string[]),
  ]);
  return [
    ...new Set([
      INDIVIDUAL_ORG_ID,
      ...memberships.map((m) => m.organizationId),
      ...ledgerScopes,
    ]),
  ];
}

export async function purgeAccount(
  deps: PurgeAccountDeps,
  input: PurgeAccountInput,
): Promise<PurgeReport> {
  const { userId, purgedBy, reason, mode } = input;
  const repo = deps.organizationRepository;
  const steps: PurgeStepResult[] = [];

  const run = async (step: PurgeStep, fn: () => Promise<string | undefined>): Promise<void> => {
    try {
      steps.push({ step, ok: true, ...(await fn().then((d) => (d ? { detail: d } : {}))) });
    } catch (err: any) {
      logger.error(`[PurgeAccount] ${step} failed for ${userId}`, { component: 'PurgeAccount' }, err);
      steps.push({ step, ok: false, error: err?.message ?? String(err) });
    }
  };

  const scopes = await resolvePurgeScopes(deps, userId);
  logger.info(`🧹 [PurgeAccount] ${mode} purge of ${userId} across ${scopes.length} scope(s)`, {
    component: 'PurgeAccount',
  });

  const contextFor = (organizationId: string): UserContext => ({
    userId,
    organizationId,
    organizationKind: deriveKindFromOrgId(organizationId),
  });

  // 1. Projects — the full lifecycle cascade, never a bare fs.rm.
  await run('projects', async () => {
    let deleted = 0;
    const failures: string[] = [];
    for (const orgId of scopes) {
      const ctx = contextFor(orgId);
      let projects: string[] = [];
      try {
        projects = await deps.projectService.listProjects(ctx);
      } catch {
        continue; // no tree for this scope
      }
      for (const projectId of projects) {
        try {
          // force: a stuck IDE pod must not strand the purge halfway.
          await deps.projectService.deleteProject(projectId, ctx, { force: true });
          deleted += 1;
        } catch (err: any) {
          failures.push(`${orgId}/${projectId}: ${err?.message ?? err}`);
        }
      }
    }
    if (failures.length > 0) throw new Error(`${failures.length} project(s) failed — ${failures.join('; ')}`);
    return `${deleted} project(s)`;
  });

  // 2. Personal files under each scope's user dir. Org-level `.ant` siblings
  //    ({ws}/{orgId}/.ant/**) are org property and are deliberately untouched.
  await run('userFiles', async () => {
    let removed = 0;
    for (const orgId of scopes) {
      const userDir = resolveTenantUserDir({
        workspacesPath: deps.workspacesPath,
        userId,
        organizationId: orgId,
        organizationKind: deriveKindFromOrgId(orgId),
      });
      const antDir = path.join(userDir, '.ant');
      for (const entry of PERSONAL_ANT_ENTRIES) {
        const target = path.join(antDir, entry);
        if (fs.existsSync(target)) {
          await fs.promises.rm(target, { recursive: true, force: true });
          removed += 1;
        }
      }
      const userConfig = path.join(userDir, 'user-config.json');
      if (fs.existsSync(userConfig)) {
        await fs.promises.rm(userConfig, { force: true });
        removed += 1;
      }
      // A full purge takes the whole user dir once its contents are gone; a
      // data-only reset leaves the anchor so the account keeps working.
      if (mode === 'full' && fs.existsSync(userDir)) {
        await fs.promises.rm(userDir, { recursive: true, force: true });
      }
    }
    return `${removed} personal file(s)/dir(s)`;
  });

  // 3. User-scoped Redis that `cleanupProject` does not reach (it is
  //    project-keyed; these are keyed by (org,user) or by user alone).
  await run('redisState', async () => {
    if (!deps.stateStore?.cleanupUserScope) return 'skipped (no state store)';
    let swept = 0;
    for (const orgId of scopes) {
      swept += await deps.stateStore.cleanupUserScope(orgId, userId);
    }
    return `${swept} key(s)`;
  });

  if (mode === 'data-only') {
    return { userId, scopes, steps, ok: steps.every((s) => s.ok) };
  }

  // 4. Memberships. `record: null` — the account is gone, so a domain-shortcut
  //    blocklist row would gate a login that can never happen.
  await run('memberships', async () => {
    const memberships = await repo.listMembershipsByUser(userId);
    for (const m of memberships) {
      await repo.removeMembership(userId, m.organizationId, { record: null });
    }
    return `${memberships.length} membership(s)`;
  });

  // 5. Org ACL rows naming the purged user. Left in place they are inert
  //    (`canEditOrgResource` needs a live membership) but a re-added namesake
  //    would silently inherit the old ownership.
  await run('orgAcls', async () => {
    const pruned = await pruneOrgAcls(deps.workspacesPath, scopes, userId);
    return `${pruned} ACL entr(ies)`;
  });

  // 6. Identity → tombstone. See the file header for why this is not a delete.
  await run('identity', async () => {
    const user = await repo.getUser(userId);
    await repo.deleteUserIdentity(userId, user?.email);
    await repo.recordUserPurge({
      userId,
      purgedAt: new Date().toISOString(),
      purgedBy,
      reason,
    });
    return 'tombstoned';
  });

  const ok = steps.every((s) => s.ok);
  logger.info(`🧹 [PurgeAccount] ${userId} purge ${ok ? 'complete' : 'completed with failures'}`, {
    component: 'PurgeAccount',
  });
  return { userId, scopes, steps, ok };
}

/** Drop the user from `owner` / `editors` in each org's resource ACL files. */
async function pruneOrgAcls(
  workspacesPath: string,
  scopes: string[],
  userId: string,
): Promise<number> {
  let pruned = 0;
  for (const orgId of scopes) {
    for (const file of ['agent-acl.json', 'pipeline-acl.json']) {
      const aclPath = path.join(workspacesPath, orgId, '.ant', file);
      if (!fs.existsSync(aclPath)) continue;
      let acl: Record<string, { owner?: string; editors?: string[] }>;
      try {
        acl = JSON.parse(await fs.promises.readFile(aclPath, 'utf-8'));
      } catch {
        continue; // corrupt ACL is not this operation's problem to fix
      }
      let dirty = false;
      for (const entry of Object.values(acl)) {
        if (entry?.owner === userId) {
          delete entry.owner;
          dirty = true;
          pruned += 1;
        }
        if (Array.isArray(entry?.editors) && entry.editors.includes(userId)) {
          entry.editors = entry.editors.filter((e) => e !== userId);
          dirty = true;
          pruned += 1;
        }
      }
      if (dirty) await fs.promises.writeFile(aclPath, JSON.stringify(acl, null, 2), 'utf-8');
    }
  }
  return pruned;
}
