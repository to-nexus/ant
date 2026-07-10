/**
 * Task & Kanban Types
 * 
 * Core task types used for decomposition, Kanban board, and SSE updates.
 * Single source of truth - both BE and FE import from here.
 */

import type { JobTiming } from './job';
import type { InterruptionDetails } from './interruption';
import type { UiSource } from './canonical';
import type { ExecutionTierId } from './session-log';
import { MODEL_REGISTRY } from './models';

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
 * - seam: Cross-feature REFERENCE + AFFORDANCE closure for one module/package,
 *         run AFTER all authoring (feature + ui) over the materialized code.
 *         Its essence is closure (resolve-or-remove), not authoring — same
 *         family as verification/error (operates on materialized code). (Code Job)
 * - explain: Explanation task (Code Job)
 * - doc: Document generation (Design Job, Code Job)
 */
export type TaskType = 'setup' | 'feature' | 'design-system' | 'ui' | 'test-code' | 'error' | 'verification' | 'seam' | 'explain' | 'doc';

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
// Derived from the MODEL_REGISTRY SSOT (@ant/shared/models.ts) — every entry
// that declares a `contextWindow`. Add/size a model there, not here. Image-only
// Gemini models carry no contextWindow (they never reach getModelContextWindow),
// so they are naturally excluded.
export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(MODEL_REGISTRY)
    .filter((m) => m.contextWindow !== undefined)
    .map((m) => [m.id, m.contextWindow as number]),
);

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

/**
 * Non-fatal variant for the token-gauge denominator seed. An unknown or missing
 * model id degrades the gauge (falls back to `DEFAULT_FALLBACK_CONTEXT_WINDOW`
 * + a one-time warn) instead of crashing the job.
 *
 * The gauge is UI chrome — its denominator being off by a factor is a cosmetic
 * regression, whereas throwing here aborts the whole graph node (the Gemini
 * visual job crashed at its first node for exactly this reason). Callers that
 * need a contractually-correct window must use the strict `getModelContextWindow`
 * and register the model in `MODEL_CONTEXT_WINDOWS`. Version-independence: a new
 * model id must never be able to crash a job over gauge accuracy.
 */
const warnedUnknownModelIds = new Set<string>();
export function getModelContextWindowOrDefault(modelId: string | undefined | null): number {
  if (modelId) {
    const window = MODEL_CONTEXT_WINDOWS[modelId];
    if (window !== undefined) return window;
  }
  const key = modelId ?? '<missing>';
  if (!warnedUnknownModelIds.has(key)) {
    warnedUnknownModelIds.add(key);
    console.warn(
      `[getModelContextWindowOrDefault] Unknown modelId "${key}" — using ` +
      `DEFAULT_FALLBACK_CONTEXT_WINDOW (${DEFAULT_FALLBACK_CONTEXT_WINDOW}) for the token gauge. ` +
      `Register it in MODEL_CONTEXT_WINDOWS (@ant/shared/task.ts) for an accurate denominator.`,
    );
  }
  return DEFAULT_FALLBACK_CONTEXT_WINDOW;
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
 * Token usage attributed to ONE model. A single job legitimately mixes models
 * across nodes (e.g. plan=Opus, execute=Sonnet), so a model-agnostic summed
 * {@link TaskTokenUsage} cannot be costed accurately. The billing pipeline
 * aggregates a `Record<modelId, TaskTokenUsage>` (see
 * {@link KanbanData.tokenUsageByModel}) and prices each entry at its own
 * model's rate via `pricing.ts`.
 */
export type TokenUsageByModel = Record<string, TaskTokenUsage>;

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
   * Model id that produced this phase's tokens (e.g. `claude-opus-4-8`).
   * Carried so the cost/credit display can price the phase at its own model's
   * rate — a phase running Opus and a phase running Sonnet must not collapse
   * into one blended cost. Optional for backward compatibility with snapshots
   * that predate billing.
   */
  modelId?: string;
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
//   - `task.band`     — Orchestrator observer: scheduling sub-classification
//                       by dependency position. On FeatureTask: foundation /
//                       platform / integration / undefined. On SetupTask:
//                       'root' (project/framework/workspace-level setup that
//                       precedes every package setup) / undefined (a package
//                       setup that owns only its own member). Other types'
//                       scheduling role is fully expressed by their `type`.
//   - `task.priority` — TaskQueue observer: integer sort key. Semantic
//                       comparison is BANNED outside the decompose
//                       priority→band mapping site.

/**
 * Feature-scheduling bands. Carried by {@link FeatureTask} only.
 *
 *   - `'foundation'`  — shared types / interfaces / pure contracts. Decompose
 *                       maps the feature.foundation priority window to this
 *                       value. Activates the `hasPreFeatureWork` barrier.
 *   - `'platform'`    — shared runtime services/state that many feature units
 *                       depend on and that themselves build on foundation
 *                       contracts (e.g. shared context/session/config
 *                       providers, shared client singletons, DI registration).
 *                       Stack-neutral: the defining axis is dependency
 *                       POSITION (consumed by many features, built on
 *                       foundation), not any "provider" mechanism. Decompose
 *                       maps the feature.platform priority window to this
 *                       value. Runs AFTER foundation, BEFORE ordinary feature
 *                       work — activates the `hasPrePlatformWork` barrier so
 *                       feature consumers bind to a real access contract
 *                       instead of hand-constructing it.
 *   - `'integration'` — cross-feature wiring. Decompose maps the
 *                       feature.integration priority window to this value.
 *                       Consumes the `hasPreIntegrationWork` barrier.
 *
 * `undefined` = an ordinary feature task (the common case) — a CONSUMER of
 * foundation contracts and platform services.
 *
 * NOTE: cross-feature reference closure is NOT a feature band — it is its own
 * `'seam'` {@link TaskType} (run AFTER ui, over the materialized graph). It was
 * a feature band historically; promoted to a type because its essence is
 * closure, not authoring (same family as verification/error).
 */
export type FeatureBand = 'foundation' | 'platform' | 'integration';

/**
 * Setup-scheduling band. Carried by {@link SetupTask} only.
 *
 *   - `'root'`  — project/framework/workspace-level setup. The SOLE owner of
 *                 root-level artifacts (in a monorepo: workspace manifest +
 *                 member glob + root tsconfig base + .gitignore + workspace
 *                 infra; in a monolith: the lone package.json + tooling
 *                 config). It creates NO member directory or member name.
 *                 Exactly one per job, at `priority === SETUP_PROJECT` (the
 *                 lowest priority → dequeues first). Activates the
 *                 root-setup-first ordering for every package setup.
 *
 * `undefined` = a package/member setup — owns exactly ONE member fully (its
 * directory + manifest/name + source skeleton). In a monolith, the single
 * package's setup (owns only the `src/` skeleton; the lone manifest is the
 * `'root'` band's).
 */
export type SetupBand = 'root';

/**
 * Seam-scheduling band. Carried by {@link SeamTask} only.
 *
 *   - `'region'` — a region sub-task: the deep, bidirectional connectivity /
 *                  disjoint audit + remediation scoped to ONE classified region
 *                  of the seam surface, spawned by `batchSplit` from the
 *                  classifying parent. The thorough audit happens HERE (per
 *                  region), not in the parent.
 *
 * `undefined` = the classifying parent seam — it reads the materialized surface
 * and carves it into regions (by app × feature-domain × concern-lane); it does
 * NOT audit or fix inline. Mirrors setup's `'root'`/undefined split (one named
 * value + the unbanded base case). NOT priority-derived: set by `batchSplit`
 * when fanning regions out, never by `deriveBandFromPriority`.
 */
export type SeamBand = 'region';

/**
 * Union of the priority-derived scheduling bands. `deriveBandFromPriority` (the
 * single priority→band site) returns this ({@link FeatureBand} for feature,
 * {@link SetupBand} for setup). {@link SeamBand} is intentionally NOT a member:
 * it is stamped by `batchSplit` (region fan-out), never derived from priority,
 * so keeping it out preserves the "every member is priority-derivable" contract.
 */
export type TaskBand = FeatureBand | SetupBand;

interface BaseTaskCommon {
  id: string;
  name: string;
  description: string;
  /** Sort key only. Semantic comparisons (priority windows / band ranges) are
   *  forbidden outside the decompose priority→band site. */
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
   * Per-model twin of `tokenUsage`, used ONLY as the batch-split Path A carry
   * channel: when a parent task is re-queued mid-flight, its accumulated
   * per-model usage rides here so the next fresh entry re-seeds
   * `_currentTaskTokenUsageByModel` (mirrors the `tokenUsage` carry). Keeps the
   * per-model billing delta in lockstep with the aggregate delta across a split.
   */
  tokenUsageByModel?: TokenUsageByModel;
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
   * Derived (NOT LLM-authored): true when this task's output renders a
   * user-visible visual surface. Set by `createTaskQueue` from ui-pairing —
   * a `ui` task, and a feature task paired with a ui task (same `parallelGroup`,
   * which includes navigation-chrome hosts that earn a paired ui pass), are
   * renderable; a headless feature with no paired ui is not. Drives the SV
   * session body-lifecycle gate (every data-bearing visual surface). Because it
   * is code-derived, not LLM-emitted, it is actualize-proof.
   */
  renderable?: boolean;
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

export type FeatureTask       = BaseTaskCommon & { type: 'feature'; band?: FeatureBand };
export type ErrorTask         = BaseTaskCommon & { type: 'error' };
export type SetupTask         = BaseTaskCommon & { type: 'setup'; band?: SetupBand };
export type UiTask            = BaseTaskCommon & { type: 'ui' };
export type DesignSystemTask  = BaseTaskCommon & { type: 'design-system' };
export type VerificationTask  = BaseTaskCommon & { type: 'verification' };
export type SeamTask          = BaseTaskCommon & { type: 'seam'; band?: SeamBand };
export type TestCodeTask      = BaseTaskCommon & { type: 'test-code' };
export type DocTask           = BaseTaskCommon & { type: 'doc' };
export type ExplainTask       = BaseTaskCommon & { type: 'explain' };

/**
 * Discriminated union over `type`. Compile-time gate keeps `band` off every
 * variant except feature (FeatureBand), setup (SetupBand=`'root'`), and seam
 * (SeamBand=`'region'`): narrowing `task.type === 'verification'` proves no
 * `band` field, a feature task can never carry `'root'` nor a setup task
 * `'foundation'`, and only a seam task may carry `'region'`. Two writers:
 * the decompose priority→band site (`deriveBandFromPriority`) writes feature /
 * setup bands; `batchSplit` stamps `'region'` on seam region children.
 */
export type BaseTask =
  | FeatureTask
  | ErrorTask
  | SetupTask
  | UiTask
  | DesignSystemTask
  | VerificationTask
  | SeamTask
  | TestCodeTask
  | DocTask
  | ExplainTask;

/**
 * Billing SSOT — is this a USER-FACING work task that the per-task platform fee
 * counts? Excludes the internal gate/remediation machinery (`verification` +
 * `error`) so batchSplit / Tier-2 escalation / remediation cycles never inflate
 * the bill. Kept here (next to `BaseTask`) so both the live meter
 * (`KanbanBroadcaster`) and terminal settle (`finalizeTerminalJob`) share one
 * predicate without a core→agents import inversion. A completed task's `type` is
 * authoritative at count time, matching `isVerificationTask`/`isErrorTask`.
 */
export function isBillableWorkTask(task: { type?: string } | null | undefined): boolean {
  const t = task?.type;
  return t !== undefined && t !== 'verification' && t !== 'error';
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

  /**
   * Per-model job-level token usage. SSOT for accurate cost: the billing
   * settle hook and the FE cost/credit display price each model's tokens at
   * its own rate. Sums to {@link KanbanData.tokenUsage} in raw tokens but
   * NOT in cost (rates differ per model). Populated alongside `tokenUsage`.
   */
  tokenUsageByModel?: TokenUsageByModel;

  /**
   * Job's execution tier (0..4), once decompose has determined it. Carried on
   * the snapshot — same reason as {@link KanbanData.tokenUsageByModel} — so the
   * billing meter/settle can index the platform-fee base matrix without reaching
   * into graph state. Undefined for non-code jobs / before tier is set.
   */
  executionTier?: ExecutionTierId;

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
