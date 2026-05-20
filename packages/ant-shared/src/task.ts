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
 * Per-model context-window lookup. SSOT for the UI gauge's denominator and
 * the backend [TokenBudgetManager](../../ant-cli/src/core/utils/tokenBudget.ts).
 *
 * Strict: an unknown model id throws. Silent fallback to a hardcoded 200k
 * would produce a 5× under-reported gauge when running against Opus 4.7's 1M
 * variant. Update the map (and only the map) when adding a new model.
 *
 * The map is the SSOT for "what context window does THIS model expose"; phase
 * snapshots carry the resolved number on `PhaseTokenUsage.contextWindow` so
 * the gauge does not need to know modelId at all.
 */
export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // Anthropic
  'claude-opus-4-7': 200_000,
  'claude-opus-4-7[1m]': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // OpenAI / Gemini follow when wired
};

export function getModelContextWindow(modelId: string | undefined | null): number {
  if (!modelId) {
    throw new Error(
      '[getModelContextWindow] modelId is required — no silent fallback to 200k. ' +
      'Caller must supply state.deps.llm.modelName or equivalent.',
    );
  }
  const window = MODEL_CONTEXT_WINDOWS[modelId];
  if (window === undefined) {
    throw new Error(
      `[getModelContextWindow] Unknown modelId "${modelId}". ` +
      `Add to MODEL_CONTEXT_WINDOWS in @ant/shared/task.ts.`,
    );
  }
  return window;
}

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

/**
 * Phase-snapshot source mode.
 *
 *   - `live`        — numbers came from an LLM API response (`usage_partial`
 *                     mid-stream or the terminal `done` event). Solid ring.
 *   - `estimating`  — pre-call approximation (e.g. `applyEstimatedInputTokens`
 *                     char→token estimate). Will be overwritten by the first
 *                     `usage_partial`. Dashed / paler ring.
 *   - `baseline`    — predicted next-call floor from the Phase-2 baseline
 *                     estimator endpoint (no LLM call ran yet for this
 *                     workspace). Dashed track, tooltip explains "next call
 *                     ≥ this much".
 *
 * Replaces the legacy `estimating: boolean` flag — `mode` is the single
 * discriminator across all three publishing moments (entry seed, mid-stream,
 * terminal, baseline).
 */
export type PhaseSnapshotMode = 'live' | 'estimating' | 'baseline';

/** Per-phase token usage entry for non-task-queue jobs (visual, plan) */
export interface PhaseTokenUsage {
  phase: string;
  label?: string;
  tokenUsage: TaskTokenUsage;
  /**
   * Source mode of the snapshot's numbers. Drives the gauge's visual variant
   * (solid vs. dashed) and tooltip wording. See {@link PhaseSnapshotMode}.
   */
  mode: PhaseSnapshotMode;
  /**
   * Model's full context window in tokens (resolved via
   * `getModelContextWindow(modelId)`). Required so the gauge's denominator
   * is model-aware — Opus 4.7 1M variant vs. Sonnet 200k must not collapse
   * into a single hardcoded constant.
   */
  contextWindow: number;
  /**
   * Worker identity (only set when the snapshot originated inside a parallel
   * worker subgraph). Undefined for the main graph / sequential execution.
   * Used by the context-gauge to render one battery per concurrent worker.
   */
  workerId?: number;
  /** Optional running task name tied to this worker, for tooltip disambiguation. */
  taskName?: string;
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
  /**
   * Resumable-failure marker. Set by parallel orchestrator failure paths when
   * pushing a task back into the queue after the worker exhausted its retry /
   * call budget. Combined with `interrupted: true`, surfaces a "Retry" badge
   * in Kanban so the user can resume. SSOT for "this task failed in the last
   * run" — there is no separate `state.failedTasks` channel.
   */
  _failed?: boolean;
  /** Human-readable error message captured at the moment of failure. */
  _failureReason?: string;
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
   * - Cleared per worker when a parallel worker terminates.
   * - `mode` is always `'live'` (or transiently `'estimating'` for the gap
   *   before the first `usage_partial` event).
   *
   * The chat-input context gauge renders one battery per entry. When this
   * array is empty / undefined, the gauge falls back to
   * {@link KanbanData.baselinePhaseTokenUsage}.
   */
  currentPhaseTokenUsages?: PhaseTokenUsage[];

  /**
   * Baseline next-call floor from the Phase-2 estimator endpoint. Always
   * `mode: 'baseline'`. Shown by the chat-input gauge only when no `live`
   * entry exists in {@link KanbanData.currentPhaseTokenUsages} (i.e. job is
   * idle / completed / never ran). Single snapshot (not an array) because the
   * baseline predicts ONE upcoming LLM call, not parallel workers.
   *
   * Populated by `KanbanBroadcaster.setBaseline()` after the baseline
   * estimator endpoint computes a fresh value. Phase-2 wires this; Phase-3
   * landed the schema slot ahead of that work.
   */
  baselinePhaseTokenUsage?: PhaseTokenUsage;

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
