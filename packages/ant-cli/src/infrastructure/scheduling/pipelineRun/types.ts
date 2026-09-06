/**
 * Shared types and cross-cluster constants for the pipeline-run modules.
 * The coordinator class (`../PipelineRunCoordinator.ts`) is the composition
 * root; every module here is free functions over `PipelineCoordinatorDeps`.
 */

import type {
  ApprovalStepDef,
  JobStepDef,
  PipelineDef,
  RunRecord,
  StepRecord,
} from '@ant/shared';
import type { StateStorePort } from '../../../core/ports/stateStore';
import type {
  PipelineApprovalEnterJobData,
  PipelineClarifyEnterJobData,
  PipelineOwner,
  ScheduleQueuePort,
} from '../../../core/ports/scheduler';
import type { StepDispatch } from '../../../core/pipelines/ChainExecutor';
import type { NotificationChannelPort, PipelineNotice } from '../../../core/pipelines/notifications';

export const COMPONENT = 'PipelineCoordinator';
export const MAX_OUTCOME_RETRIES = 5; // × 30s — lock-starved outcome re-applies
export const OUTCOME_RETRY_DELAY_MS = 30_000;

/** failStepOrRetry knobs for reasons that earn a round the step did not declare. */
export interface StepRetryOpts {
  /** Retry budget floor — grants rounds even when the step declares no `retry`. */
  budgetFloor?: number;
  /** Replaces the re-entrancy sentence in the retry preamble. */
  nudge?: string;
  /** Backoff when the step declares none (default 60s). */
  delayMsDefault?: number;
}

export interface PipelineCoordinatorDeps {
  stateStore: StateStorePort;
  scheduleQueue: ScheduleQueuePort;
  workspacesPath: string;
  workspaceResolver: {
    getPhysicalWorkspacesPath(): string;
    getProjectPath(userContext: any, projectId: string): string;
    getUniversalContainerPath(userContext: any, projectId: string): string;
  };
  workspaceService: { createWorkspace(tenantId: string, projectId: string): Promise<unknown> };
  chatService?: {
    appendChoicePresented(projectId: string, featureName: string, args: any): Promise<void>;
    appendChoiceResolved(projectId: string, featureName: string, args: any): Promise<{ resolved: boolean }>;
    appendUserTurn(
      projectId: string,
      featureName: string,
      text: string,
      turnId: string,
      jobId?: string,
      userContext?: any,
      actionMetadata?: any,
      jobType?: any,
      pipeline?: { pipelineId: string; runId: string; stepId: string; firedBy: 'cron' | 'manual' | 'event' },
    ): Promise<void>;
    appendAssistantMessage(
      projectId: string,
      featureName: string,
      text: string,
      args: { jobId: string; turnId?: string | null; jobType?: any; userContext?: any; kind?: string },
    ): Promise<void>;
  };
  /** In-memory kanban cache (API server) — parity with the HTTP dispatch path. */
  stateTracker?: {
    initializeJob(jobId: string, projectId: string, featureName: string, jobType: any, userContext?: any): void;
  };
  getJobQueue(): { enqueue(payload: any): Promise<string> };
  getCreditLedger(): { getBalance(orgId: string, userId: string): Promise<{ credits: number }> };
  /** Injected from the periphery helpers so the rule owners stay single. */
  checkApproval(userContext: { userId: string; organizationId: string }): Promise<{ status: string } | null>;
  checkTeamMembership(userContext: { userId: string; organizationId: string; organizationKind?: any }): Promise<boolean>;
  /** Gate-notice fan-out channel. Absent = the default InAppChannel (SSE). */
  notificationChannel?: NotificationChannelPort;
}

/**
 * Cross-cluster call surface. The cluster modules (fire/dispatch/gates/
 * outcome/hitl/lifecycle) never value-import each other — every edge in the
 * mutual-call graph goes through this ctx, which the coordinator class
 * assembles in its constructor. Kernel calls (runStore/render/seals) are
 * direct imports; those modules are leaves.
 */
export interface PipelineRunOps {
  deps: PipelineCoordinatorDeps;
  executeDispatches(owner: PipelineOwner, def: PipelineDef, run: RunRecord, dispatches: StepDispatch[]): Promise<void>;
  dispatchJobStep(
    owner: PipelineOwner,
    def: PipelineDef,
    run: RunRecord,
    step: JobStepDef,
    retries: number,
    directiveOverride?: string,
    approvalGrantTool?: string,
  ): Promise<void>;
  armGate(owner: PipelineOwner, def: PipelineDef, run: RunRecord, step: ApprovalStepDef): Promise<void>;
  applyOutcome(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    outcome: 'succeeded' | 'failed',
    patch?: Partial<StepRecord>,
    decorate?: (record: StepRecord) => StepRecord,
    expectedJobId?: string,
    onOutcomeLanded?: () => Promise<void>,
  ): Promise<boolean>;
  failStepOrRetry(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    error: string,
    expectedJobId?: string,
    opts?: StepRetryOpts,
  ): Promise<boolean>;
  finalizeRun(owner: PipelineOwner, run: RunRecord): Promise<void>;
  killStepJob(jobId: string, projectId: string): Promise<void>;
  enterAwaitingClarify(data: PipelineClarifyEnterJobData): Promise<void>;
  enterAwaitingToolApproval(data: PipelineApprovalEnterJobData): Promise<void>;
  /** Gate-notice fan-out (fire-and-forget; the channel logs its own failures). */
  notify(notice: PipelineNotice): Promise<void>;
}

export interface HitlRecord {
  /** Absent/'gate' = an approval STEP; 'tool' = a paused approval-gated tool call. */
  kind?: 'gate' | 'tool';
  gateId: string;
  cardId: string;
  runId: string;
  stepId: string;
  pipelineId: string;
  projectId: string;
  owner: PipelineOwner;
  onTimeout: 'reject' | 'approve';
  timeoutAt?: string;
  anchorJobId: string;
  prompt: string;
  /** kind:'tool' — the approval-gated tool name (the approve re-dispatch grant). */
  tool?: string;
  /** kind:'tool' — the paused job (stale-arm guard on resume). */
  jobId?: string;
}
