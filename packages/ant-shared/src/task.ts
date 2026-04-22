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
}

// ============================================
// Base Task
// ============================================

/** Base task interface shared by all job types */
export interface BaseTask {
  id: string;
  name: string;
  type: TaskType;
  priority: number;
  description: string;
  completed?: boolean;
  interrupted?: boolean;
  timing?: TaskTiming;
  tokenUsage?: TaskTokenUsage;
  packages?: string[];

  /**
   * Exclusive execution flag (set by decompose).
   * When true, this task cannot run concurrently with any other task.
   * The orchestrator waits until all running tasks complete before starting
   * an exclusive task, and no new tasks are started until it finishes.
   *
   * Code job: setup, error, final → exclusive: true
   * Design job: api-contract → exclusive: true
   */
  exclusive?: boolean;

  /**
   * Parallel execution group ID (set by decompose LLM).
   * Tasks sharing the same parallelGroup cannot execute simultaneously.
   * Tasks with different parallelGroup values can run in parallel.
   *
   * Ignored when exclusive is true.
   * When undefined, the task runs alone (conservative default).
   */
  parallelGroup?: string;

  /**
   * Artifact path prefix patterns for task-level document selection.
   * When set, only artifacts matching these prefixes are injected into the prompt.
   * When unset, taskType-based default rules apply (backward compatible).
   *
   * Examples:
   * - `['outputs/design/spec/spec-auth']` → specific spec only
   * - `['outputs/design/system/fe-system-main.md']` → specific system design
   * - `['outputs/design/ui/tokens', 'outputs/design/ui/spec/header']` → UI subset
   */
  include?: string[];

  /**
   * Role-annotated artifact selection policy. When present, overrides `include`
   * for role-aware selection via `selectArtifactsWithPolicy`.
   * - refs: path prefixes → select and inject as role='ref' (primary reference)
   * - context: path prefixes → select and inject as role='context' (background)
   *
   * `include` is kept as backward-compat flat projection of this policy.
   */
  artifactPolicy?: {
    refs?: string[];
    context?: string[];
  };

  /**
   * Which UiSource feeds this task (only meaningful for UI-related task types:
   * 'ui' and 'design-system'). Orthogonal to `type`:
   *   - `type` decides WHAT the task produces (e.g. design-system skeleton).
   *   - `uiSource` decides HOW to interpret the UI input (ant canonical / figma MCP / handoff observation).
   *
   * Kept BE-internal (routing + prompt dispatch only); not rendered in Kanban.
   */
  uiSource?: UiSource;
}

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
   * Latest single LLM call snapshot for the currently-running (or just-completed) graph node.
   * Overwritten on each stream `done` event; reset at node entry via beginNodePhase().
   * Used by the chat input context gauge — represents "current context fullness".
   * NOT cumulative: each call replaces the previous snapshot since inputTokens already includes
   * full prompt (system + history + current) per Anthropic's request semantics.
   */
  currentPhaseTokenUsage?: PhaseTokenUsage;

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
