/**
 * SSE Event Types — Cross-boundary contract for realtime messaging.
 *
 * Both Backend (ant-cli) and Frontend (ant-ui) import these types.
 * Single source of truth for SSE message discrimination and payload shapes.
 *
 * ## Git event unification
 *
 * The legacy `gitChange` event has been renamed to `gitState` and its payload
 * upgraded to a discriminated union on `cause`. This preserves the total SSE
 * event-type count (10) while covering three scenarios with one symbol:
 *
 * - `workingTreeChange` — lightweight hint on working-tree/index change.
 *   Payload carries only project/feature/timestamp; FE does a debounced
 *   light-weight refresh.
 * - `operationComplete`  — full snapshot pushed from a user-initiated
 *   operation's onSuccess hook. Includes snapshot, operation state, and PAT.
 * - `reconnectRefill`   — full snapshot pushed when an SSE subscription
 *   (re)opens so a reloaded client never sees a stale UI.
 */

import type { GitSnapshot, GitOperationState, GitPatState } from './git';
import type { CustomDomainStatus, CustomDomainCertStatus, CustomDomainTarget } from './deploy';
import type { RunRecord, GateDecision, PipelinePendingApproval } from './pipeline';

/**
 * Discriminator for SSE messages routed through the unified stream.
 */
export type SSEMessageType =
  | 'kanban'
  | 'chat'
  | 'fileTree'
  | 'workflow'
  | 'preview'
  | 'deploy'
  | 'gitState'
  | 'transfer'
  | 'unseenArtifacts'
  | 'bridge'
  | 'idePhase'
  | 'projectDeletionPhase'
  | 'featureDeletionPhase'
  | 'customDomainStatus'
  | 'pipeline';

/**
 * Generic phase status shared by every phased-operation SSE event
 * (idePhase / projectDeletionPhase / featureDeletionPhase / future).
 */
export type PhaseStatus = 'active' | 'complete' | 'failed';

/**
 * Generic payload base for any phased-operation SSE event. Domain-specific
 * payloads extend this with their own identifiers (projectId, featureName, ...).
 * `sessionKey` lets the FE drop stale events from a previous session.
 */
export type PhasedOperationPhaseEventData<TPhase extends string> = {
  phase: TPhase;
  status: PhaseStatus;
  sessionKey: string;
  elapsedMs: number;
  detail?: string;
};

/**
 * Generic cross-boundary error shape for phased-operation failures (project /
 * feature deletion / future). Domain shapes add a literal `kind` discriminator.
 */
export type PhasedOperationErrorShape<TPhase extends string> = {
  stage: TPhase;
  message: string;
  hint?: string;
  leftovers?: string[];
  canForceCleanup: boolean;
  retryable: boolean;
};

/**
 * IDE startup sub-phase observable to the FE. Step 5 (`frame-load`) is FE-only
 * (iframe onLoad) and is NOT emitted over SSE — included here only for
 * completeness in shared types.
 */
export type IdePhase = 'pod-pending' | 'image-pulling' | 'container-ready' | 'http-ready';

/**
 * Payload for `idePhase` SSE events. `sessionKey` (= `${projectId}:${featureName}`)
 * lets the FE drop stale events from a previous IDE session — the SSE handler
 * compares it against the current `ideSession.sessionKey` and silently ignores
 * mismatches.
 */
export type IdePhaseEventData = {
  phase: IdePhase;
  projectId: string;
  featureName: string;
  sessionKey: string;
  elapsedMs: number;
  detail?: string;
};

/**
 * Project deletion cascade sub-phases observable to the FE. Mirrors the 5
 * stages of `ProjectService.deleteProject` (`stopProjectRuntime` 4 + final
 * fs verification). Each phase carries a status so the FE can render the
 * step rail (pending → active → complete | failed).
 */
export type ProjectDeletionPhase =
  | 'cancelJobs'
  | 'ideCleanup'
  | 'previewCleanup'
  | 'redisCleanup'
  | 'fsVerify';

/** Backwards-compat alias — prefer the generic `PhaseStatus`. */
export type ProjectDeletionPhaseStatus = PhaseStatus;

/**
 * Payload for `projectDeletionPhase` SSE events. `sessionKey = projectId`
 * (only one deletion may be in-flight per project at a time). FE drops
 * events whose sessionKey doesn't match the current `projectDeletionSession`.
 */
export type ProjectDeletionPhaseEventData = PhasedOperationPhaseEventData<ProjectDeletionPhase> & {
  projectId: string;
};

/**
 * Cross-boundary error shape for project deletion failures. Mirrors
 * `GitOperationErrorShape` so the FE can route deletion errors the same
 * way it routes git errors.
 */
export type ProjectDeletionErrorShape = PhasedOperationErrorShape<ProjectDeletionPhase> & {
  kind: 'projectDeletion';
};

/**
 * Feature deletion cascade sub-phases — mirrors the 5 project deletion
 * stages so feature lifecycle stays SSOT-aligned with project lifecycle.
 * `redisCleanup` may be a no-op for features whose Redis state was already
 * sealed during `cancelJobs`; the phase is kept for symmetry.
 */
export type FeatureDeletionPhase =
  | 'cancelJobs'
  | 'ideCleanup'
  | 'previewCleanup'
  | 'redisCleanup'
  | 'fsVerify';

/**
 * Payload for `featureDeletionPhase` SSE events.
 * `sessionKey = `${projectId}:${featureName}`` — disambiguates concurrent
 * deletions across features within the same project.
 */
export type FeatureDeletionPhaseEventData = PhasedOperationPhaseEventData<FeatureDeletionPhase> & {
  projectId: string;
  featureName: string;
};

/**
 * Cross-boundary error shape for feature deletion failures. Identical
 * structure to `ProjectDeletionErrorShape` except for the `kind`
 * discriminator and `stage` element type.
 */
export type FeatureDeletionErrorShape = PhasedOperationErrorShape<FeatureDeletionPhase> & {
  kind: 'featureDeletion';
};

/**
 * Payload for `customDomainStatus` SSE events — pushes a custom domain's
 * verification / certificate progress to the FE deploy panel in realtime.
 * `sessionKey = `${projectId}:${feature}:${hostname}`` disambiguates concurrent
 * domain operations. Custom domains are deploy-only (never preview).
 */
export type CustomDomainStatusEventData = {
  projectId: string;
  feature: string;
  hostname: string;
  target: CustomDomainTarget;
  status: CustomDomainStatus;
  certStatus?: CustomDomainCertStatus;
  sessionKey: string;
  error?: string;
};

/**
 * Payload for `gitState` events. Discriminated on `cause` so each scenario
 * gets its required fields enforced at the type level.
 */
export type GitStateEventData =
  | {
      cause: 'workingTreeChange';
      project: string;
      feature?: string;
      timestamp: string;
    }
  | {
      cause: 'operationComplete';
      project: string;
      feature?: string;
      timestamp: string;
      snapshot: GitSnapshot;
      operation: GitOperationState;
      pat: GitPatState;
    }
  | {
      cause: 'reconnectRefill';
      project: string;
      feature?: string;
      timestamp: string;
      snapshot: GitSnapshot;
      pat: GitPatState;
    };

/**
 * Payload for `pipeline` events — one symbol, discriminated on `cause`
 * (gitState precedent). `runUpdate` carries the whole run record (sans the
 * frozen def snapshot) so the FE reducer is a pure replace, never a merge.
 */
export type PipelineEventData =
  | {
      cause: 'runUpdate';
      projectId: string;
      pipelineId: string;
      run: Omit<RunRecord, 'defSnapshot'>;
    }
  | {
      cause: 'approvalRequested';
      projectId: string;
      approval: PipelinePendingApproval;
    }
  | {
      cause: 'approvalResolved';
      projectId: string;
      pipelineId: string;
      runId: string;
      gateId: string;
      decision: GateDecision;
      decidedBy?: string;
    }
  | {
      cause: 'defChanged';
      projectId: string;
      pipelineId: string;
    };

/**
 * Map of event type → payload shape. Only events with a stable, shared
 * contract are listed here.
 */
export interface SSEMessageMap {
  gitState: GitStateEventData;
  idePhase: IdePhaseEventData;
  projectDeletionPhase: ProjectDeletionPhaseEventData;
  featureDeletionPhase: FeatureDeletionPhaseEventData;
  customDomainStatus: CustomDomainStatusEventData;
  pipeline: PipelineEventData;
}

// Legacy `GitChangeEventData` / `gitChange` event were retired at cutover.
// Use `GitStateEventData` and the unified `gitState` SSE event.
