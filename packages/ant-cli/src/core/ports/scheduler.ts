/**
 * Pipeline schedule-queue port. The `ant-pipelines` queue carries ONLY cheap
 * control jobs — cron fires and HITL timeout arms, never LLM work — so it may
 * retry (`attempts: 3`); the `ant-jobs` attempts:1 invariant is untouched.
 * Backed by BullMQ's Job Scheduler (natively cluster-safe: one delayed job
 * per next fire lives in Redis, any replica's worker collects it).
 */

import type { OrganizationKind, PipelineScope, StepOutputRecord } from '@ant/shared';

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
  firedBy: 'cron' | 'manual' | 'event';
  /** Set on overlap-queue re-arms so the original fire's identity survives. */
  fireEpoch?: number;
  /** Overlap-queue retry counter (bounded). */
  requeues?: number;
  /** runCompleted chain position — bounded at fire (MAX_CHAIN_DEPTH). */
  chainDepth?: number;
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
  /** Captured step output riding the re-apply (landed with the outcome). */
  output?: StepOutputRecord;
  /** The sealing job — the outcome applies only while the step still points at it. */
  jobId?: string;
  /** Failed outcome that may still consume a retry round — the re-apply re-judges. */
  retryable?: boolean;
  retries: number;
}

/**
 * Wall-clock bound for one job-step round. Armed after enqueue, re-armed on
 * every re-dispatch (same arm id), cancelled on outcome/clarify-park/cancel.
 * Expiry kills the job (stop legs) and fails the step — retryable.
 */
export interface PipelineStepTimeoutJobData {
  kind: 'step-timeout';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  /** The round this arm bounds — a newer round's jobId makes the arm stale. */
  jobId: string;
}

/**
 * Re-arm for a tool-approval-seal transition that lost the per-run lock —
 * clarify-enter parity (without it the step hangs `running` after the job
 * sealed awaiting a tool approval).
 */
export interface PipelineApprovalEnterJobData {
  kind: 'approval-enter';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  jobId: string;
  toolName: string;
  argsSummary: string;
  retries: number;
}

/** Reminder re-arm for an unresolved gate (bounded; resolve cancels it). */
export interface PipelineGateRemindJobData {
  kind: 'gate-remind';
  owner: PipelineOwner;
  pipelineId: string;
  projectId: string;
  runId: string;
  stepId: string;
  gateId: string;
  reminders: number;
}

export type PipelineControlJobData =
  | PipelineFireJobData
  | PipelineGateTimeoutJobData
  | PipelineStepRetryJobData
  | PipelineOutcomeRetryJobData
  | PipelineClarifyEnterJobData
  | PipelineApprovalEnterJobData
  | PipelineStepTimeoutJobData
  | PipelineGateRemindJobData;

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
