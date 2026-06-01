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
 * would produce a 5× under-reported gauge when running against the 1M
 * ceiling that Opus 4.8 / Sonnet 4.6 expose by default on the Claude API.
 * Update the map (and only the map) when adding a new model.
 *
 * The map is the SSOT for "what context window does THIS model expose"; phase
 * snapshots carry the resolved number on `PhaseTokenUsage.contextWindow` so
 * the gauge does not need to know modelId at all.
 */
export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // Anthropic — Opus 4.8 / Sonnet 4.6 expose 1M by default on the Claude API
  // (no beta header required since 4.6). Haiku 4.5 is 200k-only.
  'claude-opus-4-8': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  // OpenAI / Gemini follow when wired
};

/**
 * Fallback context window used by UI surfaces (e.g. `TurnTokenGauge`'s
 * empty-state ring) when no live / baseline `PhaseTokenUsage` snapshot is
 * available yet. Picked to match the modal value of `MODEL_CONTEXT_WINDOWS`
 * (Opus 4.8 + Sonnet 4.6 use 1_000_000; only Haiku 4.5 uses 200_000).
 * When a snapshot lands, the gauge switches to its model-specific
 * `contextWindow` — this constant is only the first-frame placeholder,
 * never a long-lived ground truth.
 *
 * Update if `MODEL_CONTEXT_WINDOWS` ever shifts so a different value
 * becomes the modal denominator.
 */
export const DEFAULT_FALLBACK_CONTEXT_WINDOW = 1_000_000;

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
   * is model-aware — Opus 4.8 / Sonnet 4.6 (1M) vs. Haiku 4.5 (200k) must
   * not collapse into a single hardcoded constant.
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
 *   - `'foundation'`  — shared types / interfaces / pure contracts. Decompose
 *                       maps priority band [SHARED_FOUNDATION, FOUNDATION_MAX)
 *                       (effectively below PLATFORM_MIN) to this value.
 *                       Activates the `hasPreFeatureWork` barrier.
 *   - `'platform'`    — shared runtime services/state that many feature units
 *                       depend on and that themselves build on foundation
 *                       contracts (e.g. shared context/session/config
 *                       providers, shared client singletons, DI registration).
 *                       Stack-neutral: the defining axis is dependency
 *                       POSITION (consumed by many features, built on
 *                       foundation), not any "provider" mechanism. Decompose
 *                       maps priority band [PLATFORM_MIN, PLATFORM_MAX] to this
 *                       value. Runs AFTER foundation, BEFORE ordinary feature
 *                       work — activates the `hasPrePlatformWork` barrier so
 *                       feature consumers bind to a real access contract
 *                       instead of hand-constructing it.
 *   - `'integration'` — cross-feature wiring. Decompose maps priority band
 *                       [INTEGRATION_MIN, INTEGRATION_MAX] to this value.
 *                       Consumes the `hasPreIntegrationWork` barrier.
 *
 * `undefined` = an ordinary feature task (the common case) — a CONSUMER of
 * foundation contracts and platform services.
 */
export type TaskBand = 'foundation' | 'platform' | 'integration';

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
  /**
   * Per-task tech-tier pointer. In a fullstack job each task targets exactly one
   * runtime, so `stack` selects which `basis.techTier[stack]` slot resolves to
   * `task.techTiers`. Single-stack jobs may omit it (the sole tier is used).
   * Always single at task level (no fullstack value).
   */
  stack?: 'frontend' | 'backend';
  exclusive?: boolean;
  parallelGroup?: string;
  /**
   * Single SSOT for per-task artifact injection. Artifact pool paths (or glob
   * prefixes) selected into this task's plan/execute prompt. Authored by the
   * decompose / revise LLM (RAC-validated) or seeded by task-creating helpers.
   * Empty / unset ⇒ no artifacts pre-injected (explicit `[]`, not a default).
   */
  include?: string[];
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

  /**
   * Terminal lifecycle status when the kanban represents a sealed run.
   * Mirrors `SessionRun.status` from the BE so the FE can render a result
   * badge ("실패" / "완료" / "중단됨" / "취소됨") without round-tripping to
   * the SessionRun. Absent on live `dataSource: 'live'` payloads.
   *
   * Pre-fix regression (such-pinning-milky, 2026-05-21): orchestrator
   * deadlock produced `outputStatus='failed', hasInterruption=false`. The
   * BE sealed `JOB.STATUS` as `failed` but `broadcastFinalUpdate` derived
   * SessionRun.status purely from `interruption` and fell back to
   * `completed`. The FE then rendered the run as "완료" despite 11 tasks
   * remaining in the queue. Carrying the terminal status on the kanban
   * (and on SessionRun) closes that gap at the schema layer.
   */
  status?: 'completed' | 'failed' | 'canceled' | 'paused';

  // Node activity banner (shown when a non-task node is running)
  estimatingLabel?: string;       // Current node activity label (e.g., "환경 분석 중")
  estimatingStartedAt?: string;   // ISO timestamp when current phase started (for timer)
  estimatingNodeId?: string;      // Node ID (e.g., "decompose") for UI-specific rendering

  /** All active (running/paused/queued) jobs for this feature.
   *  Only present in SSE initial kanban response, not in live broadcasts. */
  activeJobs?: ActiveJobInfo[];
}
