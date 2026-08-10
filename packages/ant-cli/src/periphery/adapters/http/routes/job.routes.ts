import { Router, Request, Response } from 'express';
import { registerFeatureParamDecoders, decodeFeatureQuery } from './helpers/featureParam';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteJobParams } from '../../../../core/ports/http';
import type { InterruptionDetails } from '../../../../core/types';
import type { StateStorePort, JobStatusData } from '../../../../core/ports/stateStore';
import type { JobProjectMapping } from '../../../../core/types/task';
import { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { REDIS_CHANNELS } from '../../../../infrastructure/state/redisConstants';
import { extractUserContext, isLocalServerMode } from './helpers/userContext';
import { assertJobAccess as assertJobAccessShared } from './helpers/jobAccess';
import { sendErrorResponse } from './helpers/errorResponse';
import { checkApproval, approvalErrorCode } from './helpers/approvalGate';
import { getAllSessionPaths, getSessionFilePathByJob } from '../../../../core/utils/sessionPaths';
import { deriveResumableState } from '../../../../core/session/resumable';
import { generateTurnId } from '../../../../composition/recordUserTurn';
import { readBranchBase } from '../../../../core/utils/branchUtils';
import { jobExecuteRateLimiter } from '../middleware/rateLimiter';
import { validateBody, executeJobSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';
import { getConfigSlots, featureNameToSlug, type SessionableJobType } from '@ant/shared';
import { isBillingEnabled } from '../../../../core/config/billingCapability';
import { getInfrastructureFactory } from '../../../../infrastructure/adapters/InfrastructureFactory';
import { peekCloudModule } from '../../../../core/cloud/cloudPlugin';
import type { JobStateTracker } from '../express/managers/JobStateTracker';
import type { KanbanService } from '../services';
import { finalizeTerminalJob } from '../express/lifecycle/finalizeTerminalJob';
import { setSessionDismissed } from './helpers/sessionCleanup';
import { getFallbackModel } from '../../../../core/config/defaultModels';

/**
 * Pre-flight credit gate for STARTING / RESUMING a job. Returns a 402 payload
 * `{ balance, required }` when the account is below the cloud overlay's
 * `minStartCredits`, else null (allow). No-op (null) when billing is disabled
 * or the cloud overlay is absent. Non-fatal on read error — a balance-check
 * failure must not block work.
 */
async function checkStartCredits(
  userContext: { userId: string; organizationId: string },
): Promise<{ balance: number; required: number } | null> {
  if (!isBillingEnabled()) return null;
  const minStartCredits = peekCloudModule()?.minStartCredits ?? 0;
  if (minStartCredits <= 0) return null;
  try {
    const ledger = getInfrastructureFactory().getCreditLedger();
    const bal = await ledger.getBalance(userContext.organizationId, userContext.userId);
    if (bal.credits < minStartCredits) {
      return { balance: bal.credits, required: minStartCredits };
    }
  } catch (err) {
    logger.warn('credit pre-flight check failed — allowing job', { component: 'JobRoute' }, err as any);
  }
  return null;
}

/**
 * Auto-resolve agent from job type when not explicitly provided.
 */
function resolveAgentForJobType(jobType: string): string {
  switch (jobType) {
    case 'plan': return 'planner';
    case 'visual': return 'creator';
    case 'universal': return 'universal';
    default: return 'architect';
  }
}

/**
 * Universal job-accept validation (fail-loud, D5): parse the composite ref and
 * load+merge the definition so a broken agent.yaml/job.yaml surfaces as HTTP
 * 400 at accept time — never inside the worker child. Returns the universal
 * container path (`{project}/universal`) that flows where a featurePath would.
 */
async function resolveUniversalExecuteContext(
  workspaceResolver: WorkspaceResolver,
  userContext: { userId: string; organizationId: string },
  projectId: string,
  customJobRef: unknown,
): Promise<
  | { ok: true; containerPath: string; ref: { agentId: string; jobId: string }; intentIds: Set<string> }
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
  try {
    const { deriveCustomAgentScopeRoots } = await import('../../../../core/customAgents/scopeRoots');
    const { loadCustomJob } = await import('../../../../core/customAgents/CustomAgentLoader');
    const loaded = loadCustomJob(deriveCustomAgentScopeRoots(projectPath), ref.agentId, ref.jobId);
    intentIds = new Set(loaded.intents.map((i) => i.id));
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : String(e), code: 'invalid-custom-job-definition' };
  }
  const { ensureUniversalContainer } = await import('../../../../core/customAgents/universalContainer');
  ensureUniversalContainer(projectPath);
  const containerPath = workspaceResolver.getUniversalContainerPath(userContext as any, projectId);
  return { ok: true, containerPath, ref, intentIds };
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
): Promise<
  | { ok: true; meta: { intents: string[]; context: string[]; plan?: boolean } | null }
  | { ok: false; status: number; error: string; code: string }
> {
  const { GENERAL_INTENT } = await import('@ant/shared');
  const intents = Array.isArray(rawIntents) ? rawIntents.filter((i): i is string => typeof i === 'string') : [];
  const context = Array.isArray(rawContext) ? rawContext.filter((c): c is string => typeof c === 'string') : [];
  const planRequested = rawPlan === true;
  if (intents.length === 0 && context.length === 0 && !planRequested) return { ok: true, meta: null };

  for (const id of intents) {
    if (id !== GENERAL_INTENT && !intentIds.has(id)) {
      return { ok: false, status: 400, error: `Unknown intent id for this job: "${id}"`, code: 'unknown-intent' };
    }
  }

  const { resolveUniversalMergedPath, UNIVERSAL_SESSIONS_NODE } = await import('../../../../core/customAgents/universalContainer');
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
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return { ok: false, status: 400, error: `Context file not found: "${rel}"`, code: 'invalid-context-path' };
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

/**
 * Reverse direction of the project-type × jobType gate (D6): canonical job
 * types never run on a universal (workspace) project. Forward direction
 * (universal job on a canonical project) lives in
 * `resolveUniversalExecuteContext`. Truth table: `decideProjectJobGate`.
 */
async function rejectCanonicalJobOnUniversalProject(
  workspaceResolver: WorkspaceResolver,
  userContext: { userId: string; organizationId: string },
  projectId: string,
  jobType: string,
): Promise<{ status: number; error: string; code: string } | null> {
  const { isUniversalProject, decideProjectJobGate } = await import('../../../../core/customAgents/universalContainer');
  let projectType: 'universal' | 'canonical' = 'canonical';
  try {
    const projectPath = workspaceResolver.getProjectPath(userContext as any, projectId);
    projectType = isUniversalProject(projectPath) ? 'universal' : 'canonical';
  } catch {
    // partial resolvers (tests) / lookup failures → canonical (gate passes;
    // canonical paths fail loudly downstream if the project is truly broken)
  }
  const gate = decideProjectJobGate(projectType, jobType);
  if (!gate.ok && gate.code === 'project-universal-requires-custom-job') {
    return {
      status: 400,
      error: `Project "${projectId}" is a universal (workspace) project — only custom agent jobs (jobType 'universal') can run here (got: ${jobType})`,
      code: gate.code,
    };
  }
  return null;
}

/**
 * Job execution routes
 * 
 * Uses Redis StateStore for cross-pod job state management (always distributed).
 */
export function createJobRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  executeJob: (params: ExecuteJobParams) => Promise<any>;
  cleanupJobState: (jobId: string, projectId?: string, featureName?: string, interruptionReason?: InterruptionDetails, explicitJobType?: SessionableJobType, userContext?: { userId: string; organizationId: string }) => Promise<void>;
  workflowStateService: import('../services/WorkflowStateService').WorkflowStateService;
  chatService: import('../services/ChatService').ChatService;
  stateStore: StateStorePort;
  stateTracker: JobStateTracker;
  kanbanService?: KanbanService;
}): Router {
  const router = Router();
  registerFeatureParamDecoders(router);

  /**
   * Mirror prereq / conflict / job-start error responses into the chat
   * stream as an `assistant_message` line so the FE renders them in the
   * conversation log without relying on legacy `addChatMessage` calls
   * from `cli.ts`. Fire-and-forget — never block the HTTP response.
   *
   * Skips when seedTurnId is missing (e.g. /resume / /continue paths
   * which do not flow through `/chat/user-message`).
   */
  async function emitConflictAssistantMessage(
    projectId: string,
    featureName: string,
    seedTurnId: string | undefined,
    jobId: string,
    userContext: { userId: string; organizationId: string },
    text: string,
  ): Promise<void> {
    if (!seedTurnId || !deps.chatService) return;
    try {
      await deps.chatService.appendAssistantMessage(projectId, featureName, text, {
        jobId,
        turnId: seedTurnId,
        userContext,
      });
    } catch (err) {
      logger.warn(
        `Failed to emit conflict assistant_message: ${(err as Error)?.message ?? err}`,
        { component: 'JobRoute' },
      );
    }
  }

  /**
   * Thin closure over `finalizeTerminalJob` so individual route handlers
   * don't repeat the `{ cleanupJobState, stateTracker, kanbanService }`
   * dep tuple. Single entry point for terminal transitions (SSOT).
   */
  async function finalize(args: {
    jobId: string;
    finalStatus: 'completed' | 'failed';
    projectId: string;
    featureName: string;
    jobType: SessionableJobType;
    userContext?: { userId: string; organizationId: string };
    interruption?: InterruptionDetails;
    featurePath?: string;
  }): Promise<void> {
    await finalizeTerminalJob(
      {
        cleanupJobState: deps.cleanupJobState,
        stateTracker: deps.stateTracker,
        kanbanService: deps.kanbanService,
      },
      args,
    );
  }
  
  /**
   * Get job status from Redis StateStore
   */
  async function getJobStatusAsync(jobId: string): Promise<JobStatusData | null> {
    return deps.stateStore.getJobStatus(jobId);
  }

  /**
   * Cross-tenant guard — delegates to the shared `assertJobAccess` owner so
   * this route file and the workflow SSE route cannot drift apart.
   */
  async function assertJobAccess(
    jobId: string,
    userContext: { userId: string; organizationId: string },
  ): Promise<{ code: number; body: { error: string } } | null> {
    return assertJobAccessShared(deps.stateStore, jobId, userContext);
  }


  /**
   * Check if feature already has a running or interrupted (paused) job
   * of the same jobType. Filters by jobType to prevent cross-type blocking
   * (e.g. a paused design job should not block a new code job).
   */
  async function checkDuplicateJob(
    userContext: { userId: string; organizationId: string },
    projectId: string,
    featureName: string,
    jobType?: string,
  ): Promise<{ jobId: string; isInterrupted: boolean } | undefined> {
    // Tenant-scoped: `projectId`/`featureName` are user-chosen and collide
    // across tenants, so an unscoped lookup would surface another tenant's
    // running job here — leaking its id in the 409 body and blocking this
    // caller from starting their own job.
    const jobs = await deps.stateStore.listJobsByFeature(userContext, projectId, featureName);
    const active = jobs.find(j =>
      (j.status === 'running' || j.status === 'paused') &&
      (!jobType || j.type === jobType)
    );
    if (!active) return undefined;
    return { jobId: active.jobId, isInterrupted: active.status === 'paused' };
  }

  /**
   * Check whether a paused job still has a resumable session file.
   * If the session was cleared (interruption is null/missing), the paused job
   * is a "zombie" that can never be dismissed via the UI — auto-dismiss it.
   */
  /**
   * Feature-slot → path resolution for routes that serve BOTH project kinds
   * (stop/dismiss): the universal pseudo-feature maps to `{project}/universal`,
   * anything else to the canonical feature path.
   */
  async function resolveFeatureContainerPath(
    userContext: { userId: string; organizationId: string },
    projectId: string,
    featureName: string,
  ): Promise<string> {
    try {
      const { resolveUniversalContainerPath } = await import('../../../../core/customAgents/universalContainer');
      const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
      const containerPath = resolveUniversalContainerPath(projectPath, featureName);
      if (containerPath) return containerPath;
    } catch {
      // partial resolvers (tests) / lookup failures → normal feature path
    }
    return deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
  }

  function hasResumableSession(featurePath: string, jobId: string): boolean {
    for (const entry of getAllSessionPaths(featurePath)) {
      try {
        if (!fs.existsSync(entry.path)) continue;
        const data = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
        if (data.state?.jobId === jobId && data.state?.interruption) {
          return true;
        }
      } catch { continue; }
    }
    return false;
  }
  
  // Execute task for a specific feature
  router.post('/projects/:id/features/:feature/execute', jobExecuteRateLimiter, validateBody(executeJobSchema), async (req: Request, res: Response) => {
    const requestReceivedAt = new Date().toISOString();
    // chat-SSOT — declared before the try block so the catch handler
    // can surface a server-side `assistant_message` line for the same
    // turn when the execute pipeline throws (queue / spawn / …).
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { task: jobType, agent = 'architect', enableEvaluation, overrideDirective, chatSource, skipTriage, actionMetadata, seedTurnId, customJobRef, intents, context, plan } = req.body;
    let userContext: { userId: string; organizationId: string } | null = null;
    try {
      userContext = extractUserContext(req);

      // Reverse gate (D6): canonical job types never run on a workspace project.
      if (jobType !== 'universal') {
        const rejected = await rejectCanonicalJobOnUniversalProject(deps.workspaceResolver, userContext, projectId, jobType);
        if (rejected) {
          await emitConflictAssistantMessage(
            projectId,
            featureName,
            seedTurnId,
            `gate-${seedTurnId ?? Date.now()}`,
            userContext,
            '워크스페이스 프로젝트에서는 커스텀 에이전트 잡만 실행할 수 있습니다.',
          );
          return res.status(rejected.status).json({ error: rejected.error, code: rejected.code });
        }
      }

      // Universal (D5/D6): validate the definition fail-loud at accept time and
      // resolve the container path that flows where a featurePath would. The
      // `:feature` URL param must be the constant universal pseudo-feature.
      let universalCtx: { containerPath: string; ref: { agentId: string; jobId: string } } | null = null;
      let universalTurnMeta: { intents: string[]; context: string[] } | null = null;
      if (jobType === 'universal') {
        const { UNIVERSAL_FEATURE } = await import('@ant/shared');
        if (featureName !== UNIVERSAL_FEATURE) {
          return res.status(400).json({
            error: `Universal jobs ride the constant '${UNIVERSAL_FEATURE}' feature slot (got: ${featureName})`,
            code: 'invalid-universal-feature',
          });
        }
        const resolved = await resolveUniversalExecuteContext(
          deps.workspaceResolver, userContext, projectId, customJobRef,
        );
        if (!resolved.ok) {
          return res.status(resolved.status).json({ error: resolved.error, code: resolved.code });
        }
        universalCtx = { containerPath: resolved.containerPath, ref: resolved.ref };

        // Explicit turn meta (`@intent:` / `@ctx:` mentions) — fail-loud at
        // accept; explicit input never silently drops.
        const metaResult = await validateUniversalTurnMeta(resolved.containerPath, resolved.intentIds, intents, context, plan);
        if (!metaResult.ok) {
          return res.status(metaResult.status).json({ error: metaResult.error, code: metaResult.code });
        }
        universalTurnMeta = metaResult.meta;
      }

      // Check if this feature already has a running or interrupted job of the same type
      const duplicate = await checkDuplicateJob(userContext, projectId, featureName, jobType);

      if (duplicate) {
        const { jobId: existingJobId, isInterrupted } = duplicate;

        if (isInterrupted) {
          // A paused job has NO live worker (the state is set by graceful
          // shutdown or StaleJobRecovery; the resume path itself re-checks the
          // BullMQ active lock). Reaching the new-job `execute` endpoint is an
          // unambiguous choice to start fresh — `resume` is a separate route —
          // so supersede the interrupted job instead of hard-blocking with 409.
          // (A genuinely `running` job still 409s below for concurrency.)
          const featurePath = universalCtx
            ? universalCtx.containerPath
            : deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
          const resumable = hasResumableSession(featurePath, existingJobId);

          logger.info(
            `Superseding interrupted job: ${existingJobId} (resumable=${resumable}) for new ${jobType} job`,
            { component: 'JobRoute' },
          );
          // Seal the paused record (status, taskQueue, workflow, etc.) so it
          // can't reappear in `listJobsByFeature` or block future jobs. jobType
          // here is the incoming request's type — matches the paused job because
          // checkDuplicateJob filtered by jobType. We do NOT re-enqueue the old
          // jobId (resume's "still being processed" race only affects same-id
          // re-enqueue); the new job below gets a fresh jobId.
          await finalize({
            jobId: existingJobId,
            finalStatus: 'failed',
            projectId,
            featureName,
            jobType: jobType as SessionableJobType | 'universal',
            userContext,
            interruption: {
              reason: 'user_stopped',
              message: resumable ? 'Superseded by a new job' : 'Auto-dismissed: session data was cleared',
              canResume: false,
              timestamp: new Date().toISOString(),
              metadata: { stoppedBy: resumable ? 'superseded_by_new_job' : 'zombie_auto_dismiss' },
            },
            featurePath,
          });

          // chat-SSOT — the superseded job's cancelled/resume cards are now
          // stale; flip them to resolved so the chat view doesn't keep a
          // dangling resume affordance for a job the user moved past. Mirrors
          // the dismiss handler's `resolveAllCancelledForJob` invocation.
          if (deps.chatService) {
            await deps.chatService.resolveAllCancelledForJob(projectId, featureName, existingJobId, {
              choiceSelected: 'dismiss',
              resolvedLabel: 'Superseded',
              userContext,
            });
          }

          // Only surface a note when recoverable progress was discarded.
          // Zombie sessions had nothing to resume, so staying silent is honest.
          if (resumable) {
            await emitConflictAssistantMessage(
              projectId,
              featureName,
              seedTurnId,
              existingJobId,
              userContext,
              '이전에 중단된 작업을 새 작업으로 대체했습니다.',
            );
          }
          // Fall through to normal job execution below.
        } else {
          await emitConflictAssistantMessage(
            projectId,
            featureName,
            seedTurnId,
            existingJobId,
            userContext,
            `이미 진행 중인 작업이 있습니다. (Job ID: ${existingJobId})`,
          );
          return res.status(409).json({
            error: 'A job is already running for this feature. Please wait for it to complete or stop it first.',
            existingJobId,
            isInterrupted: false,
            featureKey: `${projectId}/${featureName}`
          });
        }
      }

      // Matrix-driven build precondition: reject if required context is missing
      if (actionMetadata?.intent) {
        const slots = getConfigSlots(actionMetadata.intent);
        if (slots?.buildRequiresContext && (!actionMetadata.context || actionMetadata.context.length === 0)) {
          await emitConflictAssistantMessage(
            projectId,
            featureName,
            seedTurnId,
            `prereq-${seedTurnId ?? Date.now()}`,
            userContext,
            `❌ Context files must be selected for action: ${actionMetadata.intent}`,
          );
          return res.status(400).json({
            error: 'Context files must be selected for this action.',
            code: 'context-not-selected',
            intent: actionMetadata.intent,
          });
        }
      }

      const featurePath = universalCtx
        ? universalCtx.containerPath
        : deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      // Universal is chat-driven only — no meta/directives plane in the container.
      const inputFile = (overrideDirective || universalCtx) ? undefined : path.join(featurePath, `meta/directives/${jobType}/directive.md`);

      // Approval gate (stronger than credits): an unapproved account cannot
      // start work. Re-checked every start, so admin revocation takes effect
      // immediately. No-op on OSS/local (Noop repo → approved).
      const notApprovedStart = await checkApproval(userContext);
      if (notApprovedStart) {
        const code = approvalErrorCode(notApprovedStart.status);
        await emitConflictAssistantMessage(
          projectId,
          featureName,
          seedTurnId,
          `approval-${seedTurnId ?? Date.now()}`,
          userContext,
          code === 'ACCOUNT_DENIED'
            ? '계정이 비활성화되었습니다. 관리자에게 문의해 주세요.'
            : '관리자 승인 대기 중입니다. 승인 후 작업을 시작할 수 있습니다.',
        );
        return res.status(403).json({ error: 'Account is not approved.', code });
      }

      // Credit pre-flight gate: block a NEW job when the balance is below the
      // minimum start floor. The live meter + settle debit during/after the
      // job; this gate stops a genuinely empty account from starting work.
      const lowStart = await checkStartCredits(userContext);
      if (lowStart) {
        await emitConflictAssistantMessage(
          projectId,
          featureName,
          seedTurnId,
          `lowbal-${seedTurnId ?? Date.now()}`,
          userContext,
          '크레딧이 부족하여 작업을 시작할 수 없습니다. 크레딧을 충전해 주세요.',
        );
        return res.status(402).json({
          error: 'Insufficient credits to start a job.',
          code: 'insufficient_credits',
          ...lowStart,
        });
      }

      const resolvedAgent = agent || resolveAgentForJobType(jobType);
      
      const params: ExecuteJobParams = {
        agent: resolvedAgent,
        jobType,
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation,
        overrideDirective,
        chatSource,
        skipTriage,
        actionMetadata,
        userContext,
        ...(universalCtx && {
          customJobRef: `${universalCtx.ref.agentId}/${universalCtx.ref.jobId}`,
        }),
        ...(universalTurnMeta && { universalTurnMeta }),
        // chat SSOT §6 — pre-allocated turnId from /chat/user-message,
        // forwarded to the worker so the durable user_turn line shares
        // the same id as the optimistic SSE broadcast.
        seedTurnId,
      };

      const enqueuedAt = new Date().toISOString();
      const result = await deps.executeJob(params);
      logger.info(`Job enqueued: ${projectId}/${featureName} jobId=${result.jobId}`, { component: 'JobRoute' });

      // chat-SSOT — surface prereq validation failure into the chat
      // stream so the user sees the "missing materials" rejection
      // alongside their request bubble. Prior to Phase 9, this lived
      // in `cli.ts` as an optimistic FE-side `addChatMessage`; with
      // chat events now driven by SSE only, the BE owns the emission.
      if (!result.success && result.missingMaterials && result.missingMaterials.length > 0) {
        const materialsList = result.missingMaterials
          .map((m: any) => `  • ${m.name}: ${m.description}`)
          .join('\n');
        const text =
          `❌ Cannot start ${jobType} job. The following required materials are missing:\n\n${materialsList}\n\nAll of these materials must be provided before starting the job.`;
        await emitConflictAssistantMessage(
          projectId,
          featureName,
          seedTurnId,
          result.jobId ?? `prereq-${seedTurnId ?? Date.now()}`,
          userContext,
          text,
        );
      }

      res.json(result);
    } catch (error: any) {
      // chat-SSOT — server-side execute failures (queue / spawn / …)
      // also flow into the chat stream so the user is not stranded
      // with a silent 5xx. Best-effort; never block the error response.
      try {
        if (deps.chatService && seedTurnId && userContext) {
          const message = (error?.message as string) ?? 'Unknown error';
          await deps.chatService.appendAssistantMessage(
            projectId,
            featureName,
            `❌ Job 실행 실패: ${message}`,
            {
              jobId: `start-error-${seedTurnId}`,
              turnId: seedTurnId,
              userContext,
            },
          );
        }
      } catch {/* never block error response */}
      sendErrorResponse(res, 500, error, 'JobExecute');
    }
  });

  // Execute learn job on base branch (no feature context required)
  router.post('/projects/:id/learn', jobExecuteRateLimiter, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { message } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required and must be a string' });
      }

      const userContext = extractUserContext(req);

      // Reverse gate (D6): learn is a canonical job — never on a workspace project.
      const learnRejected = await rejectCanonicalJobOnUniversalProject(deps.workspaceResolver, userContext, projectId, 'learn');
      if (learnRejected) {
        return res.status(learnRejected.status).json({ error: learnRejected.error, code: learnRejected.code });
      }

      // Approval gate — an unapproved account cannot start a learn job.
      const notApprovedLearn = await checkApproval(userContext);
      if (notApprovedLearn) {
        return res.status(403).json({ error: 'Account is not approved.', code: approvalErrorCode(notApprovedLearn.status) });
      }

      // Credit pre-flight gate — a learn job runs LLM indexing work.
      const lowLearn = await checkStartCredits(userContext);
      if (lowLearn) {
        return res.status(402).json({
          error: 'Insufficient credits to start a learn job.',
          code: 'insufficient_credits',
          ...lowLearn,
        });
      }

      const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
      const branchBase = readBranchBase(projectPath);

      // Learn runs on the branchBase FEATURE — a project without features has
      // no codebase to index.
      const baseFeaturePath = path.join(projectPath, 'features', featureNameToSlug(branchBase));
      if (!fs.existsSync(baseFeaturePath)) {
        return res.status(409).json({
          error: 'Learn requires at least one feature — create a feature first.',
        });
      }

      // Check if the base feature already has a running job
      const duplicate = await checkDuplicateJob(userContext, projectId, branchBase);
      if (duplicate) {
        return res.status(409).json({
          error: 'A learn job is already running for this project. Please wait for it to complete or stop it first.',
          existingJobId: duplicate.jobId,
          isInterrupted: duplicate.isInterrupted,
          featureKey: `${projectId}/${branchBase}`
        });
      }

      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: 'learn',
        project: projectId,
        feature: branchBase,
        overrideDirective: message,
        chatSource: true,
        skipTriage: true,
        userContext
      };

      const result = await deps.executeJob(params);
      logger.info(`Base branch learn job enqueued: ${projectId}/${branchBase} jobId=${result.jobId}`, { component: 'JobRoute' });

      res.json(result);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'ProjectLearn');
    }
  });
  
  // Get task status.
  //
  // Resolution order:
  //   1. Live Redis record (`ant:job:status:{id}`) — returned as-is when present.
  //   2. Session `runs[]` fallback — terminal jobs whose Redis record was
  //      sealed by the SSOT lifecycle. We scan the three kanban session
  //      files (code/design/learn) and synthesize a `JobStatusData`-ish
  //      shape from the matching run.
  //   3. 404 when neither source knows the jobId.
  //
  // Used by e2e test helpers and ops runbooks. The ant-ui FE does not call
  // this endpoint in the normal flow — see docs/testing/e2e-runbook.md.
  // Baseline estimate — compaction-aware prediction of the heaviest LLM
  // call the next job will make. Powers the chat-input gauge's `baseline`
  // mode (PR-2 of cursor-iridescent-waffle). 5-min cache amortises the
  // Anthropic countTokens call across rapid keystrokes inside the FE's
  // 300ms debounce window.
  //
  // NOTE: declared BEFORE `/jobs/:jobId/...` so express's path matcher
  // does not greedily bind "baseline-estimate" as a jobId.
  router.get('/jobs/baseline-estimate', async (req: Request, res: Response) => {
    const intent = req.query.intent as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const featureName = decodeFeatureQuery(req.query.featureName as string | undefined);
    const draftText = (req.query.draftText as string | undefined) ?? '';
    const refsRaw = req.query.refs;
    const contextRaw = req.query.context;
    const modelId =
      (req.query.modelId as string | undefined) || getFallbackModel();

    if (!intent || !projectId || !featureName) {
      res.status(400).json({ error: 'intent, projectId, featureName are required' });
      return;
    }

    const parseList = (raw: unknown): string[] => {
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
      if (typeof raw === 'string' && raw.length > 0) {
        return raw.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
    };
    const refs = parseList(refsRaw);
    const context = parseList(contextRaw);

    let userContext: { userId: string; organizationId: string };
    try {
      userContext = extractUserContext(req);
    } catch (err) {
      sendErrorResponse(res, 401, err, 'BaselineEstimate');
      return;
    }

    let featurePath: string;
    try {
      featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    } catch (err) {
      sendErrorResponse(res, 404, err, 'BaselineEstimate');
      return;
    }

    const { estimateBaseline, BaselineEstimateError } = await import(
      '../../../../core/baselineEstimate/estimator'
    );
    try {
      const estimate = await estimateBaseline({
        intent: intent as any,
        featurePath,
        refs,
        context,
        draftText,
        modelId,
        tenantScope: {
          orgId: userContext.organizationId,
          userId: userContext.userId,
          projectId,
          featureName,
        },
        stateStore: deps.stateStore,
      });
      res.json(estimate);
    } catch (err) {
      if (err instanceof BaselineEstimateError) {
        if (err.kind === 'intent-unmapped' || err.kind === 'unknown-model') {
          res.status(400).json({ error: err.kind, message: err.message });
          return;
        }
        if (err.kind === 'template-mapping-stale') {
          // Stale heaviestNode template mapping — server-side wiring bug,
          // not a transient failure. 500 so the FE gauge falls back to
          // honest-no-baseline and engineering surfaces in error tracking.
          res.status(500).json({
            error: err.kind,
            message: err.message,
          });
          return;
        }
        // count-tokens-unavailable → 503 + explicit reason. The FE's gauge
        // stays in its no-baseline state (honest) rather than displaying a
        // fabricated floor.
        res.status(503).json({
          error: 'count_tokens unavailable',
          reason: err.message,
        });
        return;
      }
      sendErrorResponse(res, 500, err, 'BaselineEstimate');
    }
  });

  router.get('/jobs/:jobId/status', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const denied = await assertJobAccess(jobId, extractUserContext(req));
    if (denied) {
      res.status(denied.code).json(denied.body);
      return;
    }
    const status = await getJobStatusAsync(jobId);

    if (status) {
      res.json(status);
      return;
    }

    // Session runs[] fallback. Note: we don't have (projectId, featureName)
    // in the request path, so we rely on the client passing them as query
    // params for the fallback to work. Without them the fallback is skipped
    // and the endpoint returns 404 — matching pre-refactor behaviour when
    // Redis is empty.
    const projectId = req.query.projectId as string | undefined;
    const featureName = decodeFeatureQuery(req.query.featureName as string | undefined);
    if (!projectId || !featureName) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    try {
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      for (const entry of getAllSessionPaths(featurePath)) {
        if (!fs.existsSync(entry.path)) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
        } catch {
          continue;
        }
        const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
        const match = runs.find((r: any) => r?.jobId === jobId);
        if (match) {
          const synthesized: JobStatusData = {
            jobId,
            status: (match.status === 'canceled' || match.status === 'paused' || match.status === 'failed')
              ? 'failed'
              : 'completed',
            projectId,
            featureName,
            type: entry.job as JobStatusData['type'],
            startedAt: match.timestamp,
            completedAt: match.completedAt ?? match.timestamp,
            error: match.output?.error,
          };
          res.json(synthesized);
          return;
        }
      }
    } catch (err) {
      logger.warn(
        `Session runs[] fallback failed for jobId=${jobId}`,
        { component: 'JobRoute' },
        err,
      );
    }

    res.status(404).json({ error: 'Task not found' });
  });
  
  // Get queue position for a job (enriched with Redis job status for crash recovery)
  router.get('/jobs/:jobId/queue-position', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;

    const denied = await assertJobAccess(jobId, extractUserContext(req));
    if (denied) {
      res.status(denied.code).json(denied.body);
      return;
    }

    try {
      const { getInfrastructureFactory } = await import('../../../../infrastructure/adapters/InfrastructureFactory');
      const factory = getInfrastructureFactory();
      const jobQueue = factory.getJobQueue();
      const stateStore = factory.getStateStore();
      
      const position = await jobQueue.getQueuePosition(jobId);

      // Enrich with Redis job status so the UI can detect interrupted/paused jobs
      // even when BullMQ no longer has the job (e.g. after crash + stalled -> failed).
      const redisStatus = await stateStore.getJobStatus(jobId);
      const result: Record<string, any> = { ...position };
      if (redisStatus) {
        result.redisStatus = redisStatus.status;
      }

      res.json(result);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobQueuePosition');
    }
  });
  
  // Stop task — terminal transition. Sequence:
  //   1. markUserStopped + publish(STOP) → signal the worker child to exit.
  //   2. finalize(failed, user_stopped) — acquires idempotency locks BEFORE
  //      sealing so the subsequent BullMQ `completed` event (fired when the
  //      worker's child exits) can't trigger a duplicate cleanup via the
  //      RouteConfigurator subscriber.
  router.post('/jobs/:jobId/stop', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, jobType } = req.body;

    logger.info(`Stop request: job=${jobId}`, { component: 'JobRoute' });
    logger.debug(`Stop: project=${projectId}, feature=${featureName}`, { component: 'JobRoute' });
    const userContext = extractUserContext(req);
    logger.debug(`Stop: user=${userContext.userId}`, { component: 'JobRoute' });

    const denied = await assertJobAccess(jobId, userContext);
    if (denied) {
      res.status(denied.code).json(denied.body);
      return;
    }

    // Mark as user-stopped in Redis (read by JobWorker's polling backup).
    // The seal inside finalize() will DEL this shortly after the worker
    // has consumed the pub/sub STOP signal — that's OK: the polling read
    // is best-effort and the pub/sub path is primary.
    await deps.stateStore.markUserStopped(jobId);

    // Poison the job BEFORE the worker can act on the STOP signal, so the
    // child's onCheckpoint (code/graph.ts, design/session/checkpoint.ts) skips
    // its late session write during the SIGTERM grace and cannot resurrect
    // unmarked runningTasks over cleanupJobState's projection — the root cause
    // of stopped tasks staying "in-progress" on refresh. Mirrors the
    // stalled/crash path (JobWorker / BullMQJobQueue). Released on resume
    // (this router's /resume handler) and pauseJob. Best-effort: a Redis blip
    // must not delay the kill.
    await deps.stateStore.acquireLock(`ant:job-poisoned:${jobId}`, 600).catch(() => false);

    // Publish STOP signal — primary mechanism for the worker to kill its child.
    await deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, {
      jobId,
      projectId,
      featureName,
      timestamp: new Date().toISOString(),
    });

    const interruption: InterruptionDetails = {
      reason: 'user_stopped',
      message: 'Task stopped by user',
      timestamp: new Date().toISOString(),
      canResume: true,
      metadata: { stoppedBy: 'user_action' },
    };

    const resolvedJobType = (jobType || 'code') as SessionableJobType;
    const featurePath = projectId && featureName
      ? await resolveFeatureContainerPath(userContext, projectId, featureName)
      : undefined;

    await finalize({
      jobId,
      finalStatus: 'failed',
      projectId,
      featureName,
      jobType: resolvedJobType,
      userContext,
      interruption,
      featurePath,
    });

    res.json({
      success: true,
      message: 'Task stopped successfully',
      jobId,
    });
  });
  
  // Resume existing job
  router.post('/jobs/:jobId/resume', async (req: Request, res: Response) => {
    const requestedJobId = req.params.jobId;
    const { projectId, featureName, chatSource = true, customJobRef } = req.body;
    
    logger.debug(`\n🔄 [ResumeRoute] Resume request received`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   Requested jobId: ${requestedJobId} (will use session's jobId if found)`);
    
    let sessionJobId: string | null = null;
    
    try {
      const userContext = extractUserContext(req);

      const deniedResume = await assertJobAccess(requestedJobId, userContext);
      if (deniedResume) {
        return res.status(deniedResume.code).json(deniedResume.body);
      }

      // Approval gate — an unapproved account cannot resume a job either.
      const notApprovedResume = await checkApproval(userContext);
      if (notApprovedResume) {
        return res.status(403).json({ error: 'Account is not approved.', code: approvalErrorCode(notApprovedResume.status) });
      }

      // Credit pre-flight gate: a paused job can only resume if the account is
      // back above the minimum start floor (e.g. after a top-up). Mirrors the
      // fresh-start gate so an insufficient_credits pause stays paused until paid.
      const lowResume = await checkStartCredits(userContext);
      if (lowResume) {
        return res.status(402).json({
          error: 'Insufficient credits to resume the job.',
          code: 'insufficient_credits',
          ...lowResume,
        });
      }

      // ── Universal resume: the (agent, job) conversation is always-valid
      // resume context (non-task job — no task-queue checkpoint to gate on).
      // The FE supplies the definition ref; it round-trips through the
      // payload/env chain exactly like a fresh start (E2E check 4).
      if (customJobRef) {
        const resolvedUniversal = await resolveUniversalExecuteContext(
          deps.workspaceResolver, userContext, projectId, customJobRef,
        );
        if (!resolvedUniversal.ok) {
          return res.status(resolvedUniversal.status).json({ error: resolvedUniversal.error, code: resolvedUniversal.code });
        }
        const { getSessionFilePath } = await import('../../../../core/utils/sessionPaths');
        const { UNIVERSAL_FEATURE } = await import('@ant/shared');
        const universalSessionPath = getSessionFilePath(
          resolvedUniversal.containerPath, resolvedUniversal.ref.agentId, resolvedUniversal.ref.jobId,
        );
        if (!fs.existsSync(universalSessionPath)) {
          return res.status(404).json({ error: 'No universal session found', message: `No session for custom job ${customJobRef}` });
        }
        const universalSession = JSON.parse(fs.readFileSync(universalSessionPath, 'utf-8'));
        const universalJobId = universalSession.state?.jobId ?? requestedJobId;
        const universalParams: ExecuteJobParams = {
          agent: 'universal',
          jobType: 'universal',
          project: projectId,
          feature: UNIVERSAL_FEATURE,
          enableEvaluation: false,
          chatSource,
          userContext,
          jobId: universalJobId,
          isResume: true,
          customJobRef,
        };
        const universalResult = await deps.executeJob(universalParams);
        await deps.stateStore.releaseLock(`ant:job-completed:${universalJobId}`);
        await deps.stateStore.releaseLock(`ant:job-event:${universalJobId}:completed`);
        await deps.stateStore.releaseLock(`ant:job-event:${universalJobId}:failed`);
        await deps.stateStore.releaseLock(`ant:job-finalize:${universalJobId}`);
        await deps.stateStore.releaseLock(`ant:job-pause:${universalJobId}`);
        await deps.stateStore.releaseLock(`ant:job-poisoned:${universalJobId}`);
        return res.json({
          success: true,
          jobId: universalResult?.jobId ?? universalJobId,
          jobType: 'universal',
          message: `Universal custom job ${customJobRef} resumed`,
        });
      }

      // Canonical session scan below can never find a universal session —
      // fail loud instead of a misleading "no interrupted job" 404.
      {
        const rejected = await rejectCanonicalJobOnUniversalProject(deps.workspaceResolver, userContext, projectId, 'resume');
        if (rejected) {
          return res.status(rejected.status).json({ error: rejected.error, code: rejected.code });
        }
      }

      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      let jobType: string | null = null;
      let sessionData: any = null;
      let foundAgent: string | null = null;

      for (const entry of getAllSessionPaths(featurePath)) {
        if (!fs.existsSync(entry.path)) continue;
        const data = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
        if (!data.state?.jobId) continue;
        // ✅ If a specific jobId was requested, only match that exact session
        if (requestedJobId && data.state.jobId !== requestedJobId) continue;

        // ✅ Single owner of the resume verdict (code-job-flickering-sparkle):
        // do NOT hard-require a persisted `state.interruption` — an abrupt crash
        // (poison-skipped final checkpoint) leaves leftover work with no marker,
        // yet is resumable. `deriveResumableState` synthesizes `server_crash`
        // when the marker is absent, applies the jobType→canResume gate, and
        // subsumes the old stale guard (empty queue + completed → canResume:false).
        // A job being resumed is by definition not running → isActuallyRunning:false.
        const verdict = deriveResumableState(data.state, entry.job, { isActuallyRunning: false });
        if (!verdict.canResume) {
          logger.debug(`   ⚠️ ${entry.agent}/${entry.job}.json not resumable (hasWork=${verdict.hasResumableWork}, completed=${verdict.isJobCompleted})`);
          continue;
        }

        jobType = entry.job;
        foundAgent = entry.agent;
        sessionJobId = data.state.jobId;
        sessionData = data;
        logger.debug(`   Found resumable job in ${entry.agent}/${entry.job}.json (synthesized=${verdict.synthesized}, jobId: ${sessionJobId})`);
        break;
      }
      
      if (!jobType || !sessionJobId || !sessionData) {
        logger.debug(`   ❌ No interrupted job found in session files`);
        return res.status(404).json({ 
          error: 'No interrupted job found',
          message: `No resumable job found for ${projectId}/${featureName}`
        });
      }
      
      logger.debug(`   Job type: ${jobType}`);
      logger.debug(`   Starting resume job execution...`);
      
      // ✅ Resolve all unresolved cancelled cards for this jobId. The
      //   user chose to resume, so any open "Task cancelled" card the
      //   chat is showing is no longer actionable. Each pause cycle
      //   has a unique cardId (chat-SSOT §7 — pauseSeq), so we scan
      //   chat.jsonl for cardType='cancelled' lines matching jobId
      //   and emit choice_resolved for each.
      if (deps.chatService && sessionJobId) {
        await deps.chatService.resolveAllCancelledForJob(projectId, featureName, sessionJobId, {
          choiceSelected: 'resume',
          resolvedLabel: 'Resumed',
          userContext,
        });
      }

      // Explicit resume re-opens dismissed work — clear the implicit-
      // continuation marker so the session's consent state matches the
      // user's action (setSessionDismissed is a no-op when not dismissed).
      if (sessionData.state?.interruption?.dismissed === true) {
        await setSessionDismissed(deps.kanbanService, featurePath, sessionJobId, false);
      }

      // ✅ Resume always sets isResume=true. Graph router uses this + hasTaskQueue + hasResolvedAction
      // to determine correct entry point (plan, decompose, or triage)
      const hasTaskQueue = (sessionData.state?.taskQueue?.length || 0) > 0;
      
      let inputFile: string | undefined;
      
      if (!hasTaskQueue) {
        // No tasks: may need directive file for re-execution from triage
        const directivePath = path.join(featurePath, `meta/directives/${jobType}/directive.md`);
        if (fs.existsSync(directivePath)) {
          inputFile = directivePath;
        }
        logger.debug(`   No taskQueue, will re-run from appropriate entry point. directiveFile=${!!inputFile}`);
      } else {
        logger.debug(`   Plain resume: ${sessionData.state.taskQueue.length} tasks in queue`);
      }
      
      const params: ExecuteJobParams = {
        agent: (foundAgent || 'architect') as ExecuteJobParams['agent'],
        jobType: jobType as ExecuteJobParams['jobType'],
        project: projectId,
        feature: featureName,
        inputFile,
        enableEvaluation: false,
        chatSource,
        userContext,
        jobId: sessionJobId,
        isResume: true
      };
      
      const result = await deps.executeJob(params);
      
      // ✅ Clear idempotency locks AFTER executeJob so old BullMQ job is
      // removed first (inside enqueue). This closes the stale-event window
      // and ensures locks stay intact if executeJob throws.
      // Six lock layers: BullMQJobQueue completed, RouteConfigurator
      // completed, RouteConfigurator failed, finalizeTerminalJob primary,
      // pauseJob entry-level (chat SSOT §8), and the stall-recovery poison
      // flag — all TTL ≤120s except poisoned (600s).
      await deps.stateStore.releaseLock(`ant:job-completed:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:completed`);
      await deps.stateStore.releaseLock(`ant:job-event:${sessionJobId}:failed`);
      await deps.stateStore.releaseLock(`ant:job-finalize:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-pause:${sessionJobId}`);
      await deps.stateStore.releaseLock(`ant:job-poisoned:${sessionJobId}`);
      logger.debug(`   ✅ Cleared completion/failure/pause/poison idempotency locks for ${sessionJobId}`);
      
      logger.debug(`   ✅ Resume job continued with existing jobId: ${sessionJobId}`);
      logger.debug(`   ✅ Resume request completed\n`);
      
      res.json({
        success: true,
        jobId: sessionJobId,
        jobType,
        message: `Job ${sessionJobId} resumed`
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobResume');
    }
  });
  
  // Continue existing job with additional directive
  router.post('/jobs/:jobId/continue', async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const { projectId, featureName, newDirective, chatSource = true } = req.body;
    
    logger.debug(`\n➕ [ContinueRoute] Continue request received for job: ${jobId}`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   New directive: ${newDirective?.substring(0, 100)}...`);
    
    if (!newDirective || typeof newDirective !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'newDirective is required and must be a string'
      });
    }
    
    try {
      const userContext = extractUserContext(req);

      const deniedContinue = await assertJobAccess(jobId, userContext);
      if (deniedContinue) {
        return res.status(deniedContinue.code).json(deniedContinue.body);
      }

      // Approval gate — continue = resume-with-new-directive; same block.
      const notApprovedContinue = await checkApproval(userContext);
      if (notApprovedContinue) {
        return res.status(403).json({ error: 'Account is not approved.', code: approvalErrorCode(notApprovedContinue.status) });
      }

      // Credit pre-flight gate (continue = resume-with-new-directive).
      const lowContinue = await checkStartCredits(userContext);
      if (lowContinue) {
        return res.status(402).json({
          error: 'Insufficient credits to continue the job.',
          code: 'insufficient_credits',
          ...lowContinue,
        });
      }

      // Continue is canonical-session-scan only — fail loud on workspace projects.
      const continueRejected = await rejectCanonicalJobOnUniversalProject(deps.workspaceResolver, userContext, projectId, 'continue');
      if (continueRejected) {
        return res.status(continueRejected.status).json({ error: continueRejected.error, code: continueRejected.code });
      }

      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      let jobType: string | null = null;
      let sessionPath: string | null = null;
      let foundAgent: string | null = null;
      
      for (const entry of getAllSessionPaths(featurePath)) {
        if (fs.existsSync(entry.path)) {
          const sessionData = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
          if (sessionData.state?.jobId === jobId) {
            jobType = entry.job;
            sessionPath = entry.path;
            foundAgent = entry.agent;
            logger.debug(`   Found job in ${entry.agent}/${entry.job}.json`);
            break;
          }
        }
      }
      
      if (!jobType || !sessionPath) {
        logger.debug(`   ❌ Job ${jobId} not found in any session file`);
        return res.status(404).json({ 
          error: 'Job not found',
          message: `Job ${jobId} not found in session files`
        });
      }
      
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      
      if (!sessionData.state.directives) {
        sessionData.state.directives = [];
      }
      
      sessionData.state.directives.unshift(newDirective);
      
      logger.debug(`   ✅ Added new directive (total: ${sessionData.state.directives.length})`);
      
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
      logger.debug(`   ✅ Session updated with new directive`);
      
      // ✅ Resolve all unresolved cancelled cards for this jobId. See
      //   /resume route for the rationale (per-pauseSeq unique cardIds).
      const sessionJobId = sessionData.state?.jobId || jobId;
      if (deps.chatService) {
        await deps.chatService.resolveAllCancelledForJob(projectId, featureName, sessionJobId, {
          choiceSelected: 'resume',
          resolvedLabel: 'Resumed',
          userContext,
        });
      }
      
      const inputFile = undefined;
      
      const params: ExecuteJobParams = {
        agent: (foundAgent || 'architect') as ExecuteJobParams['agent'],
        jobType: jobType as ExecuteJobParams['jobType'],
        project: projectId,
        feature: featureName,
        inputFile: undefined,
        enableEvaluation: false,
        overrideDirective: newDirective,  // ✅ Pass new directive (triggers revise)
        chatSource,
        userContext,
        jobId: sessionJobId,
        isResume: true  // ✅ Always true for continue
      };
      
      const result = await deps.executeJob(params);
      
      logger.debug(`   ✅ Continue job started: ${result.jobId}`);
      logger.debug(`   ✅ Continue request completed\n`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        originalJobId: jobId,
        jobType,
        directivesCount: sessionData.state.directives.length,
        message: `Job continued from ${jobId} with new directive`
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobContinue');
    }
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Inline Ask: Handle ask queries during interrupted jobs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  router.post('/projects/:id/features/:feature/inline-ask', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { message, chatSource = true } = req.body;
    
    logger.debug(`\n💬 [InlineAskRoute] Inline ask request received`);
    logger.debug(`   Project: ${projectId}, Feature: ${featureName}`);
    logger.debug(`   Message: ${message?.substring(0, 100)}...`);
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'message is required and must be a string'
      });
    }
    
    try {
      const userContext = extractUserContext(req);

      // Reverse gate (D6): inline-ask is a canonical job — never on a workspace project.
      const inlineAskRejected = await rejectCanonicalJobOnUniversalProject(deps.workspaceResolver, userContext, projectId, 'inline-ask');
      if (inlineAskRejected) {
        return res.status(inlineAskRejected.status).json({ error: inlineAskRejected.error, code: inlineAskRejected.code });
      }

      const params: ExecuteJobParams = {
        agent: 'architect',
        jobType: 'inline-ask',
        project: projectId,
        feature: featureName,
        inputFile: undefined,
        enableEvaluation: false,
        overrideDirective: message,
        chatSource,
        userContext,
        // ✅ No jobId: always create a new job (don't reuse interrupted job's ID)
        // ✅ No isResume: this is an independent lightweight job
      };
      
      const result = await deps.executeJob(params);
      
      logger.debug(`   ✅ Inline ask job started: ${result.jobId}`);
      
      res.json({
        success: true,
        jobId: result.jobId,
        jobType: 'inline-ask',
        message: 'Inline ask job started'
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'InlineAsk');
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Decompose Spec Clarify choice (session-redesign 5-tier)
  // Body: { jobId, choice: 'redirect_to_design' | 'proceed_without_spec' | 'cancel' }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  router.post('/projects/:id/features/:feature/chat/decompose-choice', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId, choice } = req.body || {};

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const validChoices = ['redirect_to_design', 'proceed_without_spec', 'cancel'];
    if (!validChoices.includes(choice)) {
      return res.status(400).json({ error: `Invalid choice. Must be one of: ${validChoices.join(', ')}` });
    }

    try {
      const userContext = extractUserContext(req);
      const featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const codeSessionPath = getSessionFilePathByJob(featurePath, 'code');
      if (!fs.existsSync(codeSessionPath)) {
        return res.status(404).json({ error: 'No code session found for this feature' });
      }

      // Use FileSessionAdapter for a mutex-safe read (consistent with Chapter 2
      // atomic_user_turn_write and feature-log.routes.ts pattern).
      const { FileSessionAdapter } = await import('../../session/FileSessionAdapter');
      const loadAdapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
      const sessionData = await loadAdapter.load(projectId, featureName, 'code');
      const sessionState = (sessionData?.state || {}) as Record<string, any>;
      const sessionJobId: string | undefined = sessionState.jobId;
      const awaiting: boolean = sessionState.awaitingDecomposeClarify === true;
      const specClarifyPresent = Boolean(sessionState.specClarify);

      if (!awaiting || !specClarifyPresent) {
        return res.status(409).json({
          error: 'No pending spec-clarify choice for this code session',
          awaitingDecomposeClarify: awaiting,
          hasSpecClarify: specClarifyPresent,
        });
      }
      if (sessionJobId && sessionJobId !== jobId) {
        return res.status(409).json({ error: 'jobId does not match current code session', expectedJobId: sessionJobId });
      }

      const originalDirective: string | undefined =
        sessionState.overrideDirective
        || (Array.isArray(sessionState.directives) ? sessionState.directives[0] : undefined)
        || sessionState.directive;

      // Dispatch by choice
      if (choice === 'redirect_to_design') {
        // 1) Seal the paused code job as terminal (same SSOT as /dismiss).
        //    finalize handles idempotency, snapshot append, broadcast, and seal.
        const codeStatus = await deps.stateStore.getJobStatus(jobId);
        if (codeStatus?.status === 'paused') {
          await finalize({
            jobId,
            finalStatus: 'failed',
            projectId,
            featureName,
            jobType: 'code',
            userContext,
            interruption: {
              reason: 'user_stopped',
              message: 'Redirected to design via spec-clarify choice',
              canResume: false,
              timestamp: new Date().toISOString(),
              metadata: { stoppedBy: 'decompose_redirect_to_design' },
            },
            featurePath,
          });
        }

        // 2) Enqueue a fresh design job with the original directive.
        //    Allocate a seedTurnId so the Redis JobStatusData.turnId anchor is
        //    populated (RouteConfigurator seeds it from params.seedTurnId). This
        //    is the ONLY cross-pod-safe anchor tier for the cancelled/resume
        //    choice card — without it, a paused redirect-spawned design job
        //    emits no Resume/Dismiss card when the disk user_turn read lags on
        //    another pod (`no turn anchor` RCA). The same id flows to the
        //    worker's recordUserTurn so disk + Redis carry one turnId.
        const designSeedTurnId = generateTurnId();
        const designParams: ExecuteJobParams = {
          agent: 'architect',
          jobType: 'design',
          project: projectId,
          feature: featureName,
          overrideDirective: originalDirective,
          chatSource: true,
          userContext,
          seedTurnId: designSeedTurnId,
        };
        const result = await deps.executeJob(designParams);
        logger.info(`Decompose redirect_to_design: codeJob=${jobId} → designJob=${result.jobId}`, { component: 'JobRoute' });
        return res.json({
          success: true,
          choice,
          action: 'design_enqueued',
          designJobId: result.jobId,
        });
      }

      if (choice === 'proceed_without_spec') {
        // Patch session so the resumed code job bypasses specClarify on re-entry.
        // Reuse the mutex-backed adapter from the top-level load so the write
        // goes through the per-file lock (Chapter 2 atomic_user_turn_write).
        await loadAdapter.updateArtifacts(projectId, featureName, 'code', {
          state: {
            ...sessionState,
            _specClarifyBypassed: true,
            specClarify: undefined,
          },
        });
        logger.debug(`Decompose proceed_without_spec: _specClarifyBypassed=true written to code session ${jobId}`);

        const resumeParams: ExecuteJobParams = {
          agent: 'architect',
          jobType: 'code',
          project: projectId,
          feature: featureName,
          jobId: sessionJobId || jobId,
          isResume: true,
          chatSource: true,
          userContext,
        };

        const result = await deps.executeJob(resumeParams);

        // Mirror /jobs/:jobId/resume: release idempotency locks AFTER executeJob.
        // Rationale (see /resume route): the enqueue path removes the old
        // BullMQ job first; releasing locks afterwards closes the stale-event
        // window and keeps the locks intact if executeJob throws.
        // Five lock layers (chat SSOT §8 adds pauseJob):
        const resumeLockJobId = sessionJobId || jobId;
        await deps.stateStore.releaseLock(`ant:job-completed:${resumeLockJobId}`);
        await deps.stateStore.releaseLock(`ant:job-event:${resumeLockJobId}:completed`);
        await deps.stateStore.releaseLock(`ant:job-event:${resumeLockJobId}:failed`);
        await deps.stateStore.releaseLock(`ant:job-finalize:${resumeLockJobId}`);
        await deps.stateStore.releaseLock(`ant:job-pause:${resumeLockJobId}`);

        logger.info(`Decompose proceed_without_spec: resumed code job ${result.jobId}`, { component: 'JobRoute' });
        return res.json({
          success: true,
          choice,
          action: 'code_resumed',
          jobId: result.jobId,
        });
      }

      // cancel — terminal transition via the single SSOT entry point.
      // Note: we don't markUserStopped here because there's no running
      // worker child to signal — the job is already paused. finalize's
      // idempotency lock (ant:job-event:{id}:*) supplants the old manual
      // `ant:job-completed` / `ant:job-event:{id}:completed|failed` release
      // dance; there's no running worker that would re-publish completion.
      const interruption: InterruptionDetails = {
        reason: 'user_stopped',
        message: 'Spec-clarify cancelled by user',
        timestamp: new Date().toISOString(),
        canResume: false,
        metadata: { stoppedBy: 'decompose_choice_cancel' },
      };
      await finalize({
        jobId,
        finalStatus: 'failed',
        projectId,
        featureName,
        jobType: 'code',
        userContext,
        interruption,
        featurePath,
      });
      logger.info(`Decompose cancel: code job ${jobId} dismissed`, { component: 'JobRoute' });
      return res.json({ success: true, choice, action: 'code_cancelled' });
    } catch (error: any) {
      return sendErrorResponse(res, 500, error, 'DecomposeChoice');
    }
  });

  // Dismiss an interrupted/cancelled job — clears the server-side state
  // so the user can acknowledge the interruption and start a new job.
  //
  // For 'paused' jobs: transitions to sealed-failed via finalize.
  // For already-terminal / Redis-null jobs: idempotent 200 (seal already done).
  //
  // Post-seal semantics: Redis returns null for completed/failed jobs. A
  // second dismiss call therefore sees `jobStatus == null` — treated as
  // "already dismissed" rather than 404, so the UI's dismiss button stays
  // safe to click after seal has happened.
  router.post('/projects/:id/features/:feature/job/dismiss', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId } = req.body;

    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({ error: 'jobId is required' });
    }

    try {
      const userContext = extractUserContext(req);
      const jobStatus = await deps.stateStore.getJobStatus(jobId);

      // No Redis record → already sealed (terminal) or never existed. Still
      // persist the dismissed marker on the session file: a user-stopped job
      // is finalized (Redis sealed) at stop time, so THIS is the path a
      // cancelled-card dismiss actually takes — returning without touching
      // the session left the interrupted taskQueue armed to hijack the next
      // chat turn (sharp-choking-glove RCA).
      if (!jobStatus) {
        const featurePath = await resolveFeatureContainerPath(userContext, projectId, featureName);
        const patched = await setSessionDismissed(deps.kanbanService, featurePath, jobId, true);
        logger.debug(
          `Job dismiss: no Redis record (already sealed or never existed) jobId=${jobId}, sessionPatched=${patched}`,
          { component: 'JobRoute' },
        );
        return res.json({ success: true, alreadyDismissed: true, sessionPatched: patched });
      }

      const terminalStatuses = ['failed', 'completed', 'cancelled', 'stopped'];
      if (jobStatus.status === 'paused') {
        // Paused → terminal. Go through finalize for seal + broadcast + idempotency lock.
        const jobType = (jobStatus.type || 'code') as SessionableJobType;
        const featurePath = await resolveFeatureContainerPath(userContext, projectId, featureName);
        await finalize({
          jobId,
          finalStatus: 'failed',
          projectId,
          featureName,
          jobType,
          userContext,
          interruption: {
            reason: 'user_stopped',
            message: 'Dismissed by user',
            // Orthogonal axes: the work itself is intact (user_stopped IS a
            // resumable kind), so `canResume` stays true and the explicit
            // /resume route keeps working; `dismissed` withdraws implicit-
            // continuation consent (deriveRestoreMode → 'fresh' for new turns).
            canResume: true,
            dismissed: true,
            timestamp: new Date().toISOString(),
            metadata: { stoppedBy: 'dismiss' },
          },
          featurePath,
        });

        // chat-SSOT — every cancelled card carrying this jobId is now
        // stale; flip them to "Dismissed" via choice_resolved so the
        // chat view does not keep dangling unresolved cards across
        // dismiss / inline-ask 'newJob' / redirect flows. Mirrors the
        // resume path's `resolveAllCancelledForJob` invocation.
        if (deps.chatService) {
          await deps.chatService.resolveAllCancelledForJob(projectId, featureName, jobId, {
            choiceSelected: 'dismiss',
            resolvedLabel: 'Dismissed',
            userContext,
          });
        }
      } else if (terminalStatuses.includes(jobStatus.status)) {
        // Pre-refactor legacy path — Redis still holds a terminal record.
        // After this PR lands fully, seal makes this branch effectively
        // unreachable, but keep it as idempotent defense for any orphan
        // rows created before the seal path was wired.
        logger.debug(
          `Job dismiss: already terminal (${jobStatus.status}) — performing defensive seal`,
          { component: 'JobRoute' },
        );
        const jobType = (jobStatus.type || 'code') as SessionableJobType;
        const featurePath = await resolveFeatureContainerPath(userContext, projectId, featureName);
        await finalize({
          jobId,
          finalStatus: 'failed',
          projectId,
          featureName,
          jobType,
          userContext,
          featurePath,
        });
      } else {
        // Running or queued — cannot dismiss
        return res.status(400).json({ error: `Cannot dismiss job in '${jobStatus.status}' state` });
      }

      logger.info(
        `Job dismissed: ${projectId}/${featureName} jobId=${jobId} (was: ${jobStatus.status})`,
        { component: 'JobRoute' },
      );
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'JobDismiss');
    }
  });

  return router;
}
