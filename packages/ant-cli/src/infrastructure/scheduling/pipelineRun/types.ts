/**
 * Shared types and cross-cluster constants for the pipeline-run modules.
 * The coordinator class (`../PipelineRunCoordinator.ts`) is the composition
 * root; every module here is free functions over `PipelineCoordinatorDeps`.
 */

import type { StateStorePort } from '../../../core/ports/stateStore';
import type { PipelineOwner } from '../../../core/ports/scheduler';
import type { ScheduleQueuePort } from '../../../core/ports/scheduler';

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
