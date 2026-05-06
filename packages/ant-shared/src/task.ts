/**
 * Task & Kanban Types
 * 
 * Core task types used for decomposition, Kanban board, and SSE updates.
 * Single source of truth - both BE and FE import from here.
 */

import type { JobTiming } from './job';
import type { InterruptionDetails } from './interruption';
import type { UiSource } from './canonical';

// ============================================
// Task Types
// ============================================

/**
 * Task types used in decomposition
 * - setup: Environment/config setup (Code Job)
 * - feature: Feature implementation — headless skeleton (Code Job)
 * - design-system: Visual infrastructure — token/CSS setup, DS component library (Code Job)
 * - ui: Visual implementation — apply styles to skeleton (Code Job)
 * - test-code: Test code generation after features complete (Code Job)
 * - error: Error fixing (Code Job)
 * - verification: Build & runtime verification (Code Job)
 * - explain: Explanation task (Code Job)
 * - doc: Document generation (Design Job, Code Job)
 */
export type TaskType = 'setup' | 'feature' | 'design-system' | 'ui' | 'test-code' | 'error' | 'verification' | 'explain' | 'doc';

/** Task status in Kanban flow */
export type TaskStatus = 'todo' | 'in-progress' | 'completed';

// ============================================
// Task Timing & Token Usage
// ============================================

/** Timing information for a single task */
export interface TaskTiming {
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  totalPausedDuration: number;
  elapsedTime?: number;
  duration?: string;
}

/**
 * Anthropic context window (100%) used as the UI context-gauge denominator.
 * SSOT for both backend ([TokenBudgetManager](../../ant-cli/src/core/utils/tokenBudget.ts) default)
 * and frontend [TurnTokenGauge](../../ant-ui/src/presentation/components/chat/TurnTokenGauge.tsx).
 * Update this single constant when migrating to a different model with a different context window.
 */
export const CONTEXT_WINDOW_MAX_TOKENS = 200_000;

/** LLM token consumption for a task or aggregate */
export interface TaskTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Number of underlying LLM calls aggregated into this usage record. */
  callCount?: number;
}

/** Per-phase token usage entry for non-task-queue jobs (visual, plan) */
export interface PhaseTokenUsage {
  phase: string;
  label?: string;
  tokenUsage: TaskTokenUsage;
  /**
   * Worker identity (only set when the snapshot originated inside a parallel
   * worker subgraph). Undefined for the main graph / sequential execution.
   * Used by the context-gauge to render one battery per concurrent worker.
   */
  workerId?: number;
  /** Optional running task name tied to this worker, for tooltip disambiguation. */
  taskName?: string;
  /**
   * Provisional snapshot flag. True while the numbers come from a pre-call
   * prompt-size approximation (char → token ratio, no API-reported usage yet).
   * The flag is cleared as soon as a `usage_partial` or `done` event from the
   * LLM adapter overwrites the snapshot with API-reported figures.
   *
   * The chat-input token gauge can render a distinct visual cue (dashed ring,
   * paler fill, tooltip note) when this is true so users understand the number
   * is an estimate, not a measurement.
   */
  estimating?: boolean;
}

// ============================================
// Three-Axis Task Modeling — type / band / priority
// ============================================
//
// Three orthogonal observers (see `AGENTS.md` "Three-Axis Task Modeling
// SSOT"):
//   - `task.type`     — LLM observer: "what to do" (action mode)
//   - `task.band`     — Orchestrator observer: scheduling sub-classification,
//                       type-bound to FeatureTask (foundation/integration/
//                       undefined). Other types' scheduling role is already
//                       fully expressed by their `type` alone.
//   - `task.priority` — TaskQueue observer: integer sort key. Semantic
//                       comparison is BANNED outside the decompose
//                       priority→band mapping site.

/**
 * Scheduling-axis sub-classification. Type-bound to {@link FeatureTask} —
 * other types do NOT carry band (their `type` alone determines scheduling).
 *
 *   - `'foundation'`  — shared types / interfaces. Decompose maps priority
 *                       band [SHARED_FOUNDATION, FOUNDATION_MAX] to this
 *                       value. Activates the `hasPreFeatureWork` barrier.
 *   - `'integration'` — cross-feature wiring. Decompose maps priority band
 *                       [INTEGRATION_MIN, INTEGRATION_MAX] to this value.
 *                       Consumes the `hasPreIntegrationWork` barrier.
 *
 * `undefined` = an ordinary feature task (the common case).
 */
export type TaskBand = 'foundation' | 'integration';

interface BaseTaskCommon {
  id: string;
  name: string;
  description: string;
  /** Sort key only. Semantic comparisons (`priority === FINAL_VERIFICATION`,
   *  band windows) are forbidden outside the decompose priority→band site. */
  priority: number;
  completed?: boolean;
  interrupted?: boolean;
  timing?: TaskTiming;
  tokenUsage?: TaskTokenUsage;
  packages?: string[];
  exclusive?: boolean;
  parallelGroup?: string;
  /**
   * Artifact path prefix patterns for task-level document selection.
   * When set, only artifacts matching these prefixes are injected into the prompt.
   * When unset, taskType-based default rules apply (backward compatible).
   */
  include?: string[];
  /**
   * Role-annotated artifact selection policy. When present, overrides `include`
   * for role-aware selection via `selectArtifactsWithPolicy`.
   */
  artifactPolicy?: {
    refs?: string[];
    context?: string[];
  };
  /**
   * Which UiSource feeds this task (only meaningful for UI-related task types:
   * 'ui' and 'design-system'). Kept BE-internal (routing + prompt dispatch only);
   * not rendered in Kanban.
   */
  uiSource?: UiSource;
  /**
   * Set when this task was finalised by `batchSplit` Path B (drop-and-replace) —
   * the parent task's lifecycle ends here even though it never produced its
   * own files. The array carries the spawned sub-task IDs so the UI / debug
   * surface can trace lineage. `completed` stays false so superseded items
   * never inflate the "X / Y completed" counter while still rendering as a
   * separate row in `completedTasksDetails`.
   */
  supersededBy?: string[];
}

export type FeatureTask       = BaseTaskCommon & { type: 'feature'; band?: TaskBand };
export type ErrorTask         = BaseTaskCommon & { type: 'error' };
export type SetupTask         = BaseTaskCommon & { type: 'setup' };
export type UiTask            = BaseTaskCommon & { type: 'ui' };
export type DesignSystemTask  = BaseTaskCommon & { type: 'design-system' };
export type VerificationTask  = BaseTaskCommon & { type: 'verification' };
export type TestCodeTask      = BaseTaskCommon & { type: 'test-code' };
export type DocTask           = BaseTaskCommon & { type: 'doc' };
export type ExplainTask       = BaseTaskCommon & { type: 'explain' };

/**
 * Discriminated union over `type`. Compile-time gate prevents `band` from
 * appearing on non-feature variants — narrowing `task.type === 'verification'`
 * proves no `band` field. The decompose priority→band mapping site is the
 * one location that may write `band` (only on feature tasks).
 */
export type BaseTask =
  | FeatureTask
  | ErrorTask
  | SetupTask
  | UiTask
  | DesignSystemTask
  | VerificationTask
  | TestCodeTask
  | DocTask
  | ExplainTask;

// ============================================
// Active Job Info (SSE initial state)
// ============================================

/** Per-feature active job entry sent via SSE initial kanban response.
 *  Allows the frontend to track N concurrent jobs and show running indicators. */
export interface ActiveJobInfo {
  jobType: string;
  jobId: string;
  status: 'running' | 'paused' | 'queued';
  agent?: string;
}

// ============================================
// Kanban Data (SSE → Frontend)
// ============================================

/**
 * Complete Kanban board data sent to frontend via SSE.
 * Produced by: KanbanBroadcaster (live), KanbanService (session/estimating)
 * Consumed by: Frontend sseSlice.updateKanban()
 */
export interface KanbanData {
  jobId?: string;
  todo: BaseTask[];
  /** Currently executing task(s). Array for parallel execution support. */
  inProgress: BaseTask[];
  completed: BaseTask[];
  isEstimating: boolean;
  dataSource: 'live' | 'session' | 'estimating';

  // Recursion tracking
  recursionCount?: number;
  recursionLimit?: number;
  /** Active worker's task name for recursion badge display (set by frontend from workflow SSE) */
  recursionTaskName?: string;

  // Token usage (job-level aggregate)
  tokenUsage?: TaskTokenUsage;

  // Estimating phase token usage (decompose + detectEnvironment, before tasks)
  estimatingTokenUsage?: TaskTokenUsage;

  /**
   * Per-phase token breakdown for non-task-queue jobs (visual, plan).
   * Each entry represents a distinct graph node's cumulative token usage.
   * When present, the UI renders phase-based breakdown instead of task-based.
   */
  phaseTokenUsages?: PhaseTokenUsage[];

  /**
   * Latest single LLM-call snapshots for every actively-tracked graph node,
   * keyed internally by `workerId` (undefined → main graph / sequential).
   *
   * - Overwritten per worker on each stream `done` event.
   * - Preserved across SSE gaps via `kanbanReducer` when a broadcast omits it.
   * - Cleared per worker when a parallel worker terminates.
   *
   * The chat-input context gauge renders one battery per entry.
   */
  currentPhaseTokenUsages?: PhaseTokenUsage[];

  // Job metadata
  jobType?: string;
  agent?: string;

  // Timing
  jobTiming?: JobTiming;

  // Interruption state
  interruption?: InterruptionDetails;

  // Node activity banner (shown when a non-task node is running)
  estimatingLabel?: string;       // Current node activity label (e.g., "환경 분석 중")
  estimatingStartedAt?: string;   // ISO timestamp when current phase started (for timer)
  estimatingNodeId?: string;      // Node ID (e.g., "decompose") for UI-specific rendering

  /** All active (running/paused/queued) jobs for this feature.
   *  Only present in SSE initial kanban response, not in live broadcasts. */
  activeJobs?: ActiveJobInfo[];
}
