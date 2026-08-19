/**
 * Pipeline schedule-queue port. The `ant-pipelines` queue carries ONLY cheap
 * control jobs — cron fires and HITL timeout arms, never LLM work — so it may
 * retry (`attempts: 3`); the `ant-jobs` attempts:1 invariant is untouched.
 * Backed by BullMQ's Job Scheduler (natively cluster-safe: one delayed job
 * per next fire lives in Redis, any replica's worker collects it).
 */

import type { OrganizationKind } from '@ant/shared';

/** Owner coordinates stored at registration — never a token (owner delegation, D6). */
export interface PipelineOwner {
  userId: string;
  organizationId: string;
  organizationKind: OrganizationKind;
}

export interface PipelineFireJobData {
  kind: 'fire';
  owner: PipelineOwner;
  pipelineId: string;
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
  runId: string;
  stepId: string;
  gateId: string;
}

export interface PipelineStepRetryJobData {
  kind: 'step-retry';
  owner: PipelineOwner;
  pipelineId: string;
  runId: string;
  stepId: string;
  /** Duplicate-gate retry counter (bounded). */
  retries: number;
}

export type PipelineControlJobData =
  | PipelineFireJobData
  | PipelineGateTimeoutJobData
  | PipelineStepRetryJobData;

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
