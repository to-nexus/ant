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
import type { CustomAgentScopeRoot } from '../customAgents/CustomAgentLoader';

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
      /**
       * Definition scope roots, built once here. The turn-meta gate resolves
       * `_agents/**` attachments against them; NEVER re-derive
       * (`deriveCustomAgentScopeRootsForTenant` is an SSOT with a fixed
       * consumer list — a fourth derivation site is a drift vector).
       */
      scopeRoots: CustomAgentScopeRoot[];
      /**
       * intentId → `hooks.stop` artifact globs — each intent's declared
       * OUTPUT contract. The pipeline coordinator captures a completed step's
       * `{{steps.*.artifacts}}` from these; decided here because this is
       * where the definition is already loaded.
       */
      intentStopGlobs: Record<string, string[]>;
      /** intentId → declared outcomes vocabulary — the verdict contract the coordinator enforces. */
      intentOutcomes: Record<string, string[]>;
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
  let scopeRoots: CustomAgentScopeRoot[] = [];
  let intentStopGlobs: Record<string, string[]> = {};
  let intentOutcomes: Record<string, string[]> = {};
  try {
    const { deriveCustomAgentScopeRootsForTenant } = await import('../customAgents/scopeRoots');
    const { loadCustomJob } = await import('../customAgents/CustomAgentLoader');
    scopeRoots = deriveCustomAgentScopeRootsForTenant({
      workspacesPath: workspaceResolver.getPhysicalWorkspacesPath(),
      userId: userContext.userId,
      organizationId: userContext.organizationId,
      organizationKind: userContext.organizationKind ?? 'local',
    });
    const loaded = loadCustomJob(scopeRoots, ref.agentId, ref.jobId);
    intentIds = new Set(loaded.intents.map((i) => i.id));
    builtinTools = [...loaded.builtinTools];
    intentStopGlobs = Object.fromEntries(
      loaded.intents.map((i) => [
        i.id,
        (i.hooks?.stop ?? []).flatMap((h) => ('artifact' in h && typeof h.artifact === 'string' ? [h.artifact] : [])),
      ]),
    );
    intentOutcomes = Object.fromEntries(loaded.intents.filter((i) => i.outcomes?.length).map((i) => [i.id, i.outcomes!]));
    const { isSelfApiConfig } = await import('@ant/shared');
    declaresSelfApi = Object.values(loaded.apiServers).some((cfg) => isSelfApiConfig(cfg));
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e), code: 'invalid-custom-job-definition' };
  }
  const { ensureUniversalContainer } = await import('../customAgents/universalContainer');
  ensureUniversalContainer(projectPath);
  const containerPath = workspaceResolver.getUniversalContainerPath(userContext as any, projectId);
  return { ok: true, containerPath, ref, intentIds, declaresSelfApi, builtinTools, scopeRoots, intentStopGlobs, intentOutcomes };
}

/**
 * Bounded, non-failing glob expansion over the artifacts tree — the step
 * OUTPUT capture counterpart of the context-pin expansion above (same walk,
 * same caps, newest-mtime-first). Zero matches is an empty list, never an
 * error: capture is best-effort by contract.
 */
export async function expandArtifactGlobsBounded(containerPath: string, globs: readonly string[]): Promise<string[]> {
  if (globs.length === 0) return [];
  try {
    const { matchArtifactGlob } = await import('../customAgents/stopHooks');
    const { UNIVERSAL_ARTIFACTS_DIRNAME } = await import('../customAgents/universalContainer');
    const artifactsRoot = path.join(containerPath, UNIVERSAL_ARTIFACTS_DIRNAME);
    const files = walkArtifactFiles(artifactsRoot);
    const out: string[] = [];
    for (const glob of globs) {
      const matches = files
        .filter((f) => matchArtifactGlob(glob, f))
        .map((f) => ({ f, mtime: fs.statSync(path.join(artifactsRoot, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, GLOB_PIN_MAX_MATCHES)
        .map((m) => m.f);
      out.push(...matches);
      if (out.length >= GLOB_PIN_TOTAL_CONTEXT_MAX) break;
    }
    return [...new Set(out)].slice(0, GLOB_PIN_TOTAL_CONTEXT_MAX);
  } catch {
    return [];
  }
}

// Glob-pin expansion budgets (Authorization-budget doctrine: a dispatch must
// not mint unbounded walk work or prompt payload). Per-pin keeps the newest
// matches — a glob names a SET, so trimming it is degrade, not a silent drop
// of explicit input; the total is a hard refusal because past it the prompt
// band itself would be unbounded.
const GLOB_PIN_MAX_MATCHES = 20;
const GLOB_PIN_TOTAL_CONTEXT_MAX = 50;
const GLOB_WALK_MAX_DEPTH = 32;
const GLOB_WALK_MAX_ENTRIES = 5_000;

/** Bounded artifact-root walk → artifact-relative posix file paths. */
function walkArtifactFiles(rootAbs: string): string[] {
  const out: string[] = [];
  let entries = 0;
  const visit = (dirAbs: string, relPrefix: string, depth: number): void => {
    if (depth > GLOB_WALK_MAX_DEPTH || entries >= GLOB_WALK_MAX_ENTRIES) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (entries >= GLOB_WALK_MAX_ENTRIES) return;
      entries += 1;
      const rel = relPrefix ? `${relPrefix}/${d.name}` : d.name;
      if (d.isDirectory()) visit(path.join(dirAbs, d.name), rel, depth + 1);
      else if (d.isFile()) out.push(rel);
    }
  };
  visit(rootAbs, '', 0);
  return out;
}

/**
 * Validate the explicit turn meta (`@intent:` / `@ctx:` / `@plan` mentions)
 * against the job's catalog and the AGENT PLANE (artifacts ∪ `pipeline-runs`
 * ∪ `_agents` peer definitions — never `sessions`). Explicit
 * input is user intent — an unknown id is a 400 (`unknown-intent`), never a
 * silent drop (that contract belongs to the inference channel). `@plan` is
 * job-independent: a boolean per-turn flag, adopted only when strictly true.
 *
 * `expandContextGlobs` (pipeline dispatch only — interactive `@ctx` stays
 * concrete-path-only) expands glob pins (`hooks.stop` artifact vocabulary)
 * into concrete artifact paths, newest-mtime-first, before the per-path
 * checks. Zero matches fail like a missing concrete pin.
 */
export async function validateUniversalTurnMeta(
  containerPath: string,
  intentIds: Set<string>,
  rawIntents: unknown,
  rawContext: unknown,
  rawPlan?: unknown,
  builtinTools?: readonly string[],
  scopeRoots: CustomAgentScopeRoot[] = [],
  opts: { expandContextGlobs?: boolean } = {},
): Promise<
  | { ok: true; meta: { intents: string[]; context: string[]; plan?: boolean } | null; contextExpanded?: Record<string, number> }
  | { ok: false; status: number; error: string; code: string }
> {
  const { GENERAL_INTENT } = await import('@ant/shared');
  const intents = Array.isArray(rawIntents) ? rawIntents.filter((i): i is string => typeof i === 'string') : [];
  let context = Array.isArray(rawContext) ? rawContext.filter((c): c is string => typeof c === 'string') : [];
  const planRequested = rawPlan === true;
  if (intents.length === 0 && context.length === 0 && !planRequested) return { ok: true, meta: null };

  let contextExpanded: Record<string, number> | undefined;
  if (opts.expandContextGlobs && context.some((c) => c.includes('*'))) {
    const { validateArtifactGlob, UNIVERSAL_PIPELINE_RUNS_DIRNAME } = await import('@ant/shared');
    const { matchArtifactGlob } = await import('../customAgents/stopHooks');
    const { UNIVERSAL_ARTIFACTS_DIRNAME } = await import('../customAgents/universalContainer');
    // The walk root is the artifacts dir itself — `sessions/` and the
    // `pipeline-runs` graft live under other physical roots, so a glob can
    // only ever address the artifacts tree.
    const artifactsRoot = path.join(containerPath, UNIVERSAL_ARTIFACTS_DIRNAME);
    const files = walkArtifactFiles(artifactsRoot);
    const expanded: string[] = [];
    contextExpanded = {};
    for (const rel of context) {
      if (!rel.includes('*')) {
        expanded.push(rel);
        continue;
      }
      const glob = rel.trim();
      const globErr =
        validateArtifactGlob(glob, 'context') ??
        (glob.split('/')[0] === 'sessions' || glob.split('/')[0] === UNIVERSAL_PIPELINE_RUNS_DIRNAME
          ? `context glob "${glob}" may only address the artifacts tree`
          : null);
      if (globErr) {
        return { ok: false, status: 400, error: `Invalid context glob: "${rel}" (${globErr})`, code: 'invalid-context-path' };
      }
      const matches = files
        .filter((f) => matchArtifactGlob(glob, f))
        .map((f) => ({ f, mtime: fs.statSync(path.join(artifactsRoot, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, GLOB_PIN_MAX_MATCHES)
        .map((m) => m.f);
      if (matches.length === 0) {
        return { ok: false, status: 400, error: `Context file not found for glob: "${rel}"`, code: 'invalid-context-path' };
      }
      contextExpanded[glob] = matches.length;
      expanded.push(...matches);
    }
    context = [...new Set(expanded)];
    if (context.length > GLOB_PIN_TOTAL_CONTEXT_MAX) {
      return {
        ok: false,
        status: 400,
        error: `Context expands to ${context.length} files (max ${GLOB_PIN_TOTAL_CONTEXT_MAX}) — narrow the globs`,
        code: 'invalid-context-path',
      };
    }
  }

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

  // Attachability is judged against the AGENT PLANE — the same roots the tool
  // sandbox mounts. `sessions/**` throws here (outside the sandbox), `_agents/**`
  // resolves to a peer definition, everything else to the artifacts tree.
  const { resolveUniversalAgentPlanePath } = await import('../customAgents/universalAgentPlane');
  const { isAllowedDefinitionPath, classifyDefinitionDir, parseUniversalAgentRef } = await import('@ant/shared');
  for (const rel of context) {
    let resolved: { absPath: string; root: string; agentId?: string };
    try {
      resolved = resolveUniversalAgentPlanePath(rel, { containerPath, scopeRoots });
    } catch (e) {
      return {
        ok: false,
        status: 400,
        error: `Invalid context path: "${rel}" (${e instanceof Error ? e.message : String(e)})`,
        code: 'invalid-context-path',
      };
    }
    // A peer definition is addressed by the definition VOCABULARY, not by
    // whatever happens to sit in the dir — the same whitelist the save funnel
    // enforces, so the two surfaces name the same set of files.
    if (resolved.root === 'agents') {
      const rest = parseUniversalAgentRef(rel)!.rest;
      if (!isAllowedDefinitionPath(rest) && classifyDefinitionDir(rest) === 'unknown') {
        return {
          ok: false,
          status: 400,
          error: `Context path "${rel}" is not a definition file or directory`,
          code: 'invalid-context-path',
        };
      }
    }
    if (!fs.existsSync(resolved.absPath)) {
      return { ok: false, status: 400, error: `Context file not found: "${rel}"`, code: 'invalid-context-path' };
    }
    if (fs.statSync(resolved.absPath).isDirectory() && builtinTools && !builtinTools.includes('list_files')) {
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
    ...(contextExpanded && { contextExpanded }),
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
