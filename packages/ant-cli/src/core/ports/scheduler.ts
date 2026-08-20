/**
 * Pipeline schedule-queue port. The `ant-pipelines` queue carries ONLY cheap
 * control jobs — cron fires and HITL timeout arms, never LLM work — so it may
 * retry (`attempts: 3`); the `ant-jobs` attempts:1 invariant is untouched.
 * Backed by BullMQ's Job Scheduler (natively cluster-safe: one delayed job
 * per next fire lives in Redis, any replica's worker collects it).
 */

import type { OrganizationKind, PipelineScope } from '@ant/shared';

/**
 * ACTIVATOR coordinates stored at registration — never a token (owner
 * delegation, D6). The scheduling unit is an activation, so the "owner" of
 * every control job is the user who activated the pipeline on the project:
 * their identity is what dispatch re-judges and what the work bills to.
 */
export interface PipelineOwner {
  userId: string;
  organizationId: string;
  organizationKind: OrganizationKind;
}

export interface PipelineFireJobData {
  kind: 'fire';
  owner: PipelineOwner;
  pipelineId: string;
  /** Scope root pinned at activate time — fire never resolves closest-wins. */
  pipelineScope: PipelineScope;
  /** The activation's project — with `owner`, addresses the activation dir. */
  projectId: string;
  firedBy: 'cron' | 'manual';
  /** Set on overlap-queue re-arms so the original fire's identity survives. */
  fireEpoch?: number;
  /** Overlap-queue retry counter (bounded). */
  requeues?: number;
}

export interface PipelineGateTimeoutJobData {
  kind: 'gate-timeout';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  gateId: string;
}

export interface PipelineStepRetryJobData {
  kind: 'step-retry';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  /** Duplicate-gate retry counter (bounded). */
  retries: number;
  /** Clarify-resume re-dispatch: the user's answer replaces the step directive. */
  directiveOverride?: string;
}

/**
 * Re-arm for a clarify-seal transition that lost the per-run lock — parity
 * with `outcome-retry` (without it the step hangs `running` after the job
 * already sealed awaiting a clarify answer).
 */
export interface PipelineClarifyEnterJobData {
  kind: 'clarify-enter';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  jobId: string;
  question: string;
  toolUseId?: string;
  retries: number;
}

/**
 * Re-arm for a step OUTCOME that lost the per-run lock (starvation): without
 * this the outcome is dropped and the run hangs `running` until the overlap
 * TTL. Bounded like the duplicate-gate retry.
 */
export interface PipelineOutcomeRetryJobData {
  kind: 'outcome-retry';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  outcome: 'succeeded' | 'failed';
  error?: string;
  retries: number;
}

export type PipelineControlJobData =
  | PipelineFireJobData
  | PipelineGateTimeoutJobData
  | PipelineStepRetryJobData
  | PipelineOutcomeRetryJobData
  | PipelineClarifyEnterJobData;

export interface ScheduleQueuePort {
  /** Idempotent upsert of a cron scheduler (`schedulerId` = owner-scoped pipeline key). */
  upsertCron(schedulerId: string, cron: string, tz: string | undefined, data: PipelineFireJobData): Promise<void>;
  removeCron(schedulerId: string): Promise<void>;
  /** All registered scheduler ids — reconciliation sweeps orphans against disk. */
  listCronIds(): Promise<string[]>;
  /** One-shot delayed control job. `jobId` dedupes; re-arming replaces. */
  armDelayed(jobId: string, delayMs: number, data: PipelineControlJobData): Promise<void>;
  cancelDelayed(jobId: string): Promise<void>;
  /** Immediate control job (run-now rides the same fire path as cron). */
  addNow(data: PipelineControlJobData): Promise<void>;
  close(): Promise<void>;
}
