/**
 * UniversalDispatchGate — the accept-time gates a universal job dispatch must
 * pass, extracted from `job.routes.ts` so the HTTP route and the pipeline
 * scheduler judge with the SAME functions and cannot drift. The route keeps
 * its own orchestration (chat-line emission on rejection, supersede of paused
 * jobs); the scheduler composes these into `evaluatePipelineStepGate`-style
 * checks inside the coordinator. Rule owners that already have a home are NOT
 * duplicated here: `checkApproval` / `checkTeamMembership` stay in
 * `periphery/.../helpers/approvalGate.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { isBillingEnabled } from '../config/billingCapability';
import { peekCloudModule } from '../cloud/cloudPlugin';

// ============================================
// Definition / turn-meta accept gates (moved verbatim from job.routes.ts)
// ============================================

/**
 * Universal job-accept validation (fail-loud, D5): parse the composite ref and
 * load+merge the definition so a broken agent.yaml/job.yaml surfaces as HTTP
 * 400 at accept time — never inside the worker child. Returns the universal
 * container path (`{project}/universal`) that flows where a featurePath would.
 */
export async function resolveUniversalExecuteContext(
  workspaceResolver: {
    getProjectPath(userContext: any, projectId: string): string;
    getPhysicalWorkspacesPath(): string;
    getUniversalContainerPath(userContext: any, projectId: string): string;
  },
  userContext: { userId: string; organizationId: string; organizationKind?: import('@ant/shared').OrganizationKind },
  projectId: string,
  customJobRef: unknown,
): Promise<
  | {
      ok: true;
      containerPath: string;
      ref: { agentId: string; jobId: string };
      intentIds: Set<string>;
      /**
       * The definition declares an `apis` self entry, so this job needs a
       * capability-pinned token to reach this server's own API. Decided here
       * because this is where the definition is already loaded — the dispatch
       * owner mints from the flag, and a job that declares nothing gets no
       * credential at all.
       */
      declaresSelfApi: boolean;
      /** Job tool allowlist — the turn-meta gate needs it to judge directory attachments. */
      builtinTools: string[];
    }
  | { ok: false; status: number; error: string; code: string }
> {
  const { parseCustomJobRef } = await import('@ant/shared');
  const ref = parseCustomJobRef(typeof customJobRef === 'string' ? customJobRef : undefined);
  if (!ref) {
    return { ok: false, status: 400, error: `Invalid or missing customJobRef (expected "{agentId}/{jobId}"): ${String(customJobRef)}`, code: 'invalid-custom-job-ref' };
  }
  const projectPath = workspaceResolver.getProjectPath(userContext as any, projectId);
  // Policy flag (D6): custom jobs run only in universal-type projects.
  try {
    const configRaw = fs.readFileSync(path.join(projectPath, 'config.json'), 'utf-8');
    const projectType = JSON.parse(configRaw)?.projectType;
    if (projectType !== 'universal') {
      return { ok: false, status: 400, error: `Project "${projectId}" is not a universal-type project (projectType: ${projectType ?? 'canonical'})`, code: 'project-not-universal' };
    }
  } catch (e) {
    return { ok: false, status: 400, error: `Cannot read project config for "${projectId}": ${e instanceof Error ? e.message : String(e)}`, code: 'project-config-unreadable' };
  }
  let intentIds: Set<string>;
  let declaresSelfApi = false;
  let builtinTools: string[] = [];
  try {
    const { deriveCustomAgentScopeRootsForTenant } = await import('../customAgents/scopeRoots');
    const { loadCustomJob } = await import('../customAgents/CustomAgentLoader');
    const scopeRoots = deriveCustomAgentScopeRootsForTenant({
      workspacesPath: workspaceResolver.getPhysicalWorkspacesPath(),
      userId: userContext.userId,
      organizationId: userContext.organizationId,
      organizationKind: userContext.organizationKind ?? 'local',
    });
    const loaded = loadCustomJob(scopeRoots, ref.agentId, ref.jobId);
    intentIds = new Set(loaded.intents.map((i) => i.id));
    builtinTools = [...loaded.builtinTools];
    const { isSelfApiConfig } = await import('@ant/shared');
    declaresSelfApi = Object.values(loaded.apiServers).some((cfg) => isSelfApiConfig(cfg));
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e), code: 'invalid-custom-job-definition' };
  }
  const { ensureUniversalContainer } = await import('../customAgents/universalContainer');
  ensureUniversalContainer(projectPath);
  const containerPath = workspaceResolver.getUniversalContainerPath(userContext as any, projectId);
  return { ok: true, containerPath, ref, intentIds, declaresSelfApi, builtinTools };
}

/**
 * Validate the explicit turn meta (`@intent:` / `@ctx:` / `@plan` mentions)
 * against the job's catalog and the container's artifacts subtree. Explicit
 * input is user intent — an unknown id is a 400 (`unknown-intent`), never a
 * silent drop (that contract belongs to the inference channel). `@plan` is
 * job-independent: a boolean per-turn flag, adopted only when strictly true.
 */
export async function validateUniversalTurnMeta(
  containerPath: string,
  intentIds: Set<string>,
  rawIntents: unknown,
  rawContext: unknown,
  rawPlan?: unknown,
  builtinTools?: readonly string[],
): Promise<
  | { ok: true; meta: { intents: string[]; context: string[]; plan?: boolean } | null }
  | { ok: false; status: number; error: string; code: string }
> {
  const { GENERAL_INTENT } = await import('@ant/shared');
  const intents = Array.isArray(rawIntents) ? rawIntents.filter((i): i is string => typeof i === 'string') : [];
  const context = Array.isArray(rawContext) ? rawContext.filter((c): c is string => typeof c === 'string') : [];
  const planRequested = rawPlan === true;
  if (intents.length === 0 && context.length === 0 && !planRequested) return { ok: true, meta: null };

  // A run binds at most ONE intent — the intent is the atomic unit of work
  // (completion contract, schedule node). Checked on the deduped set so a
  // repeated mention (['a','a']) stays legal.
  const uniqueIntents = [...new Set(intents)];
  if (uniqueIntents.length > 1) {
    return {
      ok: false,
      status: 400,
      error: `A run binds at most one intent (got: ${uniqueIntents.map((i) => `"${i}"`).join(', ')})`,
      code: 'multiple-intents',
    };
  }

  for (const id of intents) {
    if (id !== GENERAL_INTENT && !intentIds.has(id)) {
      return { ok: false, status: 400, error: `Unknown intent id for this job: "${id}"`, code: 'unknown-intent' };
    }
  }

  const { resolveUniversalMergedPath, UNIVERSAL_SESSIONS_NODE } = await import('../customAgents/universalContainer');
  for (const rel of context) {
    const first = rel.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0];
    if (first === UNIVERSAL_SESSIONS_NODE) {
      // sessions is outside the agent sandbox (artifacts + definition mount
      // only) — an attached file the agent cannot read is a broken promise.
      return { ok: false, status: 400, error: `Context path is outside the artifacts tree: "${rel}"`, code: 'invalid-context-path' };
    }
    let full: string;
    try {
      full = resolveUniversalMergedPath(containerPath, rel);
    } catch {
      return { ok: false, status: 400, error: `Invalid context path: "${rel}"`, code: 'invalid-context-path' };
    }
    if (!fs.existsSync(full)) {
      return { ok: false, status: 400, error: `Context file not found: "${rel}"`, code: 'invalid-context-path' };
    }
    if (fs.statSync(full).isDirectory() && builtinTools && !builtinTools.includes('list_files')) {
      // Explicit input never silently drops: a directory the agent cannot
      // enumerate is a dead promise, so refuse at accept instead.
      return {
        ok: false,
        status: 400,
        error: `Context path "${rel}" is a directory, but this job's tools.builtin grants no list_files — attach individual files instead`,
        code: 'context-dir-not-listable',
      };
    }
  }

  return {
    ok: true,
    meta: {
      intents: [...new Set(intents)],
      context: [...new Set(context)],
      ...(planRequested && { plan: true }),
    },
  };
}

// ============================================
// Concurrency / credit gates
// ============================================

/**
 * Feature-scoped duplicate check (tenant-scoped listing — an unscoped lookup
 * would leak another tenant's jobId in the 409 body). `running` blocks;
 * `paused` is the caller's policy call (the route supersedes, the scheduler
 * re-arms).
 */
export async function findDuplicateActiveJob(
  stateStore: {
    listJobsByFeature(
      userContext: { userId: string; organizationId: string },
      projectId: string,
      featureName: string,
    ): Promise<Array<{ jobId: string; status: string; type?: string }>>;
  },
  userContext: { userId: string; organizationId: string },
  projectId: string,
  featureName: string,
  jobType?: string,
): Promise<{ jobId: string; isInterrupted: boolean } | undefined> {
  const jobs = await stateStore.listJobsByFeature(userContext, projectId, featureName);
  const active = jobs.find((j) =>
    (j.status === 'running' || j.status === 'paused') &&
    (!jobType || j.type === jobType),
  );
  if (!active) return undefined;
  return { jobId: active.jobId, isInterrupted: active.status === 'paused' };
}

/**
 * Pipeline mutual-exclusion gate: while a project has an ACTIVE pipeline, the
 * pipeline owns the project — every interactive job start (execute / resume /
 * continue / inline-ask) is rejected so scheduled steps are never superseded
 * or queued behind a human. Reads the `ant:pipe:proj` PROJECTION (disk
 * `activation.json` is SSOT; the TTL+reconciler refresh means the gate fails
 * OPEN when the projection lapses, never closed). This is a separate gate
 * axis from `decideProjectJobGate` (project×jobType truth table) — never fold
 * it in there. The pipeline coordinator itself never calls this: the pipeline
 * is exempt from its own lock.
 */
export async function findProjectPipelineActivation(
  stateStore: { getKey(key: string): Promise<string | null> },
  userContext: { userId: string; organizationId: string },
  projectId: string,
): Promise<{ pipelineId: string } | null> {
  const { REDIS_KEYS } = await import('../constants/redis');
  try {
    const pipelineId = await stateStore.getKey(
      REDIS_KEYS.PIPE.PROJECT(userContext.organizationId, userContext.userId, projectId),
    );
    return pipelineId ? { pipelineId } : null;
  } catch (err) {
    logger.warn('pipeline-activation gate read failed — allowing job', { component: 'DispatchGate' }, err as any);
    return null;
  }
}

/**
 * Pre-flight credit gate for STARTING / RESUMING a job. Returns a 402 payload
 * `{ balance, required }` when the account is below the cloud overlay's
 * `minStartCredits`, else null (allow). No-op (null) when billing is disabled
 * or the cloud overlay is absent. Non-fatal on read error — a balance-check
 * failure must not block work. The ledger is injected so this stays a core
 * module (the composition site resolves the infrastructure factory).
 */
export async function checkStartCredits(
  userContext: { userId: string; organizationId: string },
  getCreditLedger: () => { getBalance(orgId: string, userId: string): Promise<{ credits: number }> },
): Promise<{ balance: number; required: number } | null> {
  if (!isBillingEnabled()) return null;
  const minStartCredits = peekCloudModule()?.minStartCredits ?? 0;
  if (minStartCredits <= 0) return null;
  try {
    const bal = await getCreditLedger().getBalance(userContext.organizationId, userContext.userId);
    if (bal.credits < minStartCredits) {
      return { balance: bal.credits, required: minStartCredits };
    }
  } catch (err) {
    logger.warn('credit pre-flight check failed — allowing job', { component: 'DispatchGate' }, err as any);
  }
  return null;
}
