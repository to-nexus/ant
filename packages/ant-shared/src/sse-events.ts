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
  | 'idePhase';

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
 * Map of event type → payload shape. Only events with a stable, shared
 * contract are listed here.
 */
export interface SSEMessageMap {
  gitState: GitStateEventData;
  idePhase: IdePhaseEventData;
}

// Legacy `GitChangeEventData` / `gitChange` event were retired at cutover.
// Use `GitStateEventData` and the unified `gitState` SSE event.
