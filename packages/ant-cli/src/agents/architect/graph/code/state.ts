import { CodebaseProfile } from "../../../../core/types";
import type { Conversations } from '../../../common/graph/conversations';
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort, TaskQueueUpdatePort } from "../../../../core/ports";
import type { PromptBuilder } from "../../../../core/prompt/builder/PromptBuilder";
import { ProjectContext } from "../../types";
import { CodeTask, TaskQueue as BaseTaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { TriageableState } from '../../../common/graph/nodes/triage/types';
import type { ResolvedActionContext, ResolvedArtifact, Boundary, SpecClarify, BaseTask, TaskType, TaskBand, TokenUsageByModel } from '@ant/shared';
import type { ExecutionTierId } from "../../../../core/executionTier";
import type { FeatureContext } from "../../../../core/context/featureContextBuilder";
// `PlanEntry` is phase-blind (consumed by router/plan/enforce regardless of
// task type). Source it from the `_shared/` layer.
import type { PlanEntry } from "./tasks/_shared/types";

export interface IntegrationRequirement {
  name: string;
  type?: 'database' | 'api' | 'auth' | 'other';
  description?: string;
}

/**
 * Structured violation record — per-attempt signal produced by
 * checkTaskStatus and verify hooks, consumed by routing, plan-prompt
 * composition, RAG file selection, and execute retry-context injection.
 *
 * `isRetryable` is the producer-owned retryability hint; checkTaskStatus
 * filters non-retryable violations out before recording them in
 * `EnforcementFeedback`.
 */
export interface Violation {
  type: ViolationType;
  message: string;
  file?: string;
  suggestedFix?: string;
  isRetryable?: boolean;
}

/**
 * Violation Types — error category taxonomy.
 *
 * When adding a new value, land its producer (emitter) in the same change.
 * Add a consumer branch (router / prompt guidance) only if the new type
 * needs differentiated handling beyond the default formatter path. Values
 * without a producer become dead surface and are removed on sight.
 */
export type ViolationType =
  | 'missing_file'              // required file missing — checkTaskStatus/evaluate
  | 'file_operation_failed'     // edit search-block / duplicate-edit etc. — checkTaskStatus/evaluate
  | 'cross_worker_conflict'     // file owned by another parallel worker — checkTaskStatus/evaluate (parallel only)
  | 'no_done_signal'            // reached checkTaskStatus without <done> (Safety Net forced exit) — checkTaskStatus/evaluate
  | 'incomplete_implementation' // reserved: "test suite exists" is single-owned by the Final Verification gate, not per test-code batch (RCA: equal-nursing-drift). No active producer; retained for a future FV-level disk-scan owner.
  | 'asset_not_placed'          // plan declared implementation.assets[] but a destination still lacks the source bytes — checkTaskStatus/evaluate (completion output gate)
  | 'other';                    // fallback for unclassified errors — _common/errorHandler.ts

/**
 * Recursion-budget drain threshold (single SSOT).
 *
 * When a task's remaining recursion budget (`recursionLimit - recursionCount`)
 * drops below this, the graph stops attempting new work and drains to `learn`
 * (best-effort completion) rather than starting another plan/execute cycle.
 *
 * Consumed by the three sites that gate on near-exhaustion so they agree on one
 * boundary (no dead-band): `routers/executeRouter.ts` Safety Net A,
 * `routing.ts` (sequential checkTaskStatus drain), and
 * `parallel/workerGraph.ts` (worker checkTaskStatus drain). Safety Net A only
 * fires once the LLM has emitted neither a tool call nor `<done>` — i.e. a
 * genuinely non-productive turn — so a pending gate-rerun is never discarded.
 */
export const RECURSION_DRAIN_THRESHOLD = 20;

/**
 * No-progress circuit breaker (rocky-beating-coral RCA, 2026-07-19).
 *
 * Bounds a SUCCESS-blind degenerate execute loop: consecutive execute turns
 * whose only activity was re-reading already-read content (every tool result
 * duplicate-elided, no file streamed, no tool mutation, no `<done>`). All
 * pre-existing brakes are failure-gated (Safety Net B), verification-gated
 * (Safety Net A), or config-gated (LangGraph recursionLimit) — none of them
 * fires when identical reads keep SUCCEEDING (296-round incident loop).
 *
 * Consumers: `routers/executeRouter.ts` (hard divert to checkTaskStatus at
 * the cap, BEFORE the toolCalls route) and `nodes/execute/drainFinalize.ts`
 * (persistent tool-strip salvage from CAP − MARGIN). The streak lives in
 * `_noProgressStreak`; see that channel's contract for writers/resets.
 *
 * Cap rationale: the signal counts only provably zero-information rounds
 * (novel reads / commands / mutations reset it), so 10 salvage-free rounds
 * + 5 tool-stripped salvage turns is generous — unlike the design job's
 * NO_OUTPUT_HARD_CAP (25) whose no-file-write signal can be legitimate
 * exploration and needs headroom.
 */
export const NO_PROGRESS_HARD_CAP = 15;
/**
 * The execute node runs forced-finalization turns (tools stripped, "apply
 * your changes now") starting this many steps BEFORE the router breaker, so
 * salvage happens while responses still route normally. Persistent while the
 * trigger holds — one-shot salvage is ignored by degenerate models
 * (sandy-building-dryad lesson).
 */
export const DRAIN_FINALIZE_MARGIN = 5;

/**
 * No-forward-output circuit breaker (cyan-catching-cedar RCA, 2026-07-23).
 *
 * Complements `NO_PROGRESS_HARD_CAP`. That cap counts provably-zero-information
 * rounds (dup reads / repeat commands / repeated text); it stays at 0 forever
 * when a degenerate loop keeps issuing genuinely NOVEL reads — novel line
 * ranges of already-read files, novel `search_code` — while producing no
 * mutation / `<done>`. cyan-catching-cedar burned ~156 such rounds
 * (final-verification, glm-5.2) before the user aborted.
 *
 * This cap bounds "consecutive execute turns with NO forward output" directly
 * — the only reset is real forward output — so it is a hard ceiling for every
 * model and task type regardless of read/search novelty. Ported from the
 * design job's proven `NO_OUTPUT_HARD_CAP` (design/routers/executeRouter.ts):
 * the code job's Safety Net C had ported design's dup-read counter + salvage
 * but never this no-output window. Consumers: `routers/executeRouter.ts`
 * (Safety Net C2, hard divert at the cap, BEFORE the toolCalls route) and
 * `nodes/execute/drainFinalize.ts` (salvage from CAP − MARGIN = 25). Lives in
 * `_noOutputStreak`.
 *
 * Cap rationale: 30 (design uses 25). The execute phase is preceded by a full
 * plan phase that does the heavy reading, so sustained pure-read in execute is
 * already suspicious; 30 leaves a small margin for verification tasks that
 * inspect more files in execute, and the salvage soft-landing at 25 offers a
 * `<done>` escape before the hard divert.
 */
export const NO_OUTPUT_HARD_CAP = 30;

/**
 * Task Priority SSOT — normalized by (task type, task band).
 *
 * A task is defined by **type + band** (Three-Axis model). Priority is the
 * TaskQueue ordering key ONLY (lower number = dequeues first); it carries no
 * semantic meaning outside this map. The single numeric source of truth is the
 * `TASK_PRIORITY` window map: first key = `TaskType`, second key = band
 * (`'default'` = `band === undefined`). Band-less types hold only `default`.
 *
 * Window phases (contiguous, non-overlapping):
 *   setup.root 100 → setup 101-189 → design-system 200-219 →
 *   feature.foundation 220-259 → feature.platform 260-299 →
 *   feature 300-599 → feature.integration 600-649 → ui 650-749 →
 *   seam 750-799 → test-code 800-849 → doc 850-899 → error 900-999 →
 *   verification 1000.
 *
 * Phase code never reads these numbers — it calls `windowFor` /
 * `basePriorityFor`, or asks the scheduling `classify` hook. The ONLY
 * priority→band translation site is `deriveBandFromPriority`
 * (decompose/responseParser), which reverse-looks-up this same map.
 *
 * design-system [200,219] and feature.foundation [220,259] are DISTINCT
 * windows: design-system is a TYPE (no band derivation), feature.foundation
 * is a band. `deriveBandFromPriority` is therefore strict — only [220,259]
 * derives 'foundation'.
 *
 * NOTE: the design JOB has its own, orthogonal priority axis (doc tasks at
 * 100-299 for tokens/assets) — see `DESIGN_DOC_BANDS` in
 * `tasks/doc/hooks/scheduling.ts`. It is NOT this map and must not be unified.
 */
export interface PriorityWindow {
  readonly min: number;
  readonly max: number;
}

type BandWindows = { readonly default: PriorityWindow } & {
  readonly [band: string]: PriorityWindow;
};

export const TASK_PRIORITY: Readonly<Record<
  Exclude<TaskType, 'explain'>,
  BandWindows
>> = {
  setup: { root: { min: 100, max: 100 }, default: { min: 101, max: 189 } },
  'design-system': { default: { min: 200, max: 219 } },
  feature: {
    foundation: { min: 220, max: 259 },
    platform: { min: 260, max: 299 },
    default: { min: 300, max: 599 }, // band === undefined (ordinary feature)
    integration: { min: 600, max: 649 },
  },
  ui: { default: { min: 650, max: 749 } },
  seam: { default: { min: 750, max: 799 } },
  'test-code': { default: { min: 800, max: 849 } },
  doc: { default: { min: 850, max: 899 } },
  error: { default: { min: 900, max: 999 } },
  verification: { default: { min: 1000, max: 1000 } },
} as const;

/**
 * Lane-mode batchSplit child priority is `parentPriority + offset` (the parent
 * is emitted at its window base; lane slices stack upward). This is the maximum
 * legal `priorityInParallelGroup` offset — bounded by the NARROWEST
 * lane-fanning window so a child never crosses out of its parent's window into
 * the next band/type. The narrowest such windows are the feature foundation /
 * platform bands (`max - min === 39`). Guarded by
 * `tests/policy/priority-constants.test.ts`.
 */
export const MAX_LANE_OFFSET = 39;

/**
 * The priority window for a (type, band) pair. `band === undefined` (or a band
 * absent from the type) resolves to the type's `default` window. A type with no
 * window (`explain`, or an unrecognized LLM-emitted type string) falls back to
 * the ordinary-feature window — matching `DEFAULT_TASK_TYPE = 'feature'`, so an
 * untyped/garbage task sorts as an ordinary feature rather than crashing.
 */
export function windowFor(type: TaskType, band?: TaskBand): PriorityWindow {
  const byBand =
    (TASK_PRIORITY as Record<string, BandWindows | undefined>)[type] ?? TASK_PRIORITY.feature;
  return (band && byBand[band]) || byBand.default;
}

/**
 * The canonical emit / fallback priority for a (type, band) pair — the base
 * (min) of its window. Used as the "missing priority" default per task type
 * (replaces the former single magic-number default).
 */
export function basePriorityFor(type: TaskType, band?: TaskBand): number {
  return windowFor(type, band).min;
}

/**
 * The Final Verification priority (verification is a single-point window). Used
 * by the verification creation sites + classifier; derived from the map so it
 * never drifts. (verification is always the final task — there is no
 * "non-final" verification task; see `tasks/verification/model/is.ts`.)
 */
export const VERIFICATION_PRIORITY = TASK_PRIORITY.verification.default.min;

export type { ErrorCategory } from '../../../../core/types/session';
import type { ErrorCategory } from '../../../../core/types/session';

/**
 * Per-attempt enforcement feedback — appended to `state.enforcementHistory`
 * whenever checkTaskStatus produces retryable violations. Bridges retries
 * and job resumptions: the array is persisted in the session checkpoint and
 * read back by `buildRetryContext` so the LLM sees prior attempts.
 */
export interface EnforcementFeedback {
  taskId: string;
  taskName: string;
  attemptNumber: number;
  violations: Violation[];
  timestamp: number;
}

export interface AttemptHistory {
  attemptNumber: number;           // Which attempt this was (1, 2, 3...)
  filesGenerated: string[];        // List of files created/modified
  keyChanges: string[];            // Human-readable summary of changes
  subtaskName?: string;            // Which subtask this was for (if any)
  errorsAttemptedToFix: string[];  // Which errors this attempt tried to fix
}

/**
 * Code Task State (REFACTORED)
 * State for code generation graph (generate/refactor/explain)
 *
 * Legacy artifact fields are declared directly below.
 * Pool-based nodes use `artifacts: ResolvedArtifact[]`; the legacy fields
 * are retained only until all consumers migrate to the pool.
 */
export interface ArchitectGraphState extends TriageableState {
  // Context (narrowed from TriageableContext)
  context: ProjectContext & { enableEvaluation?: boolean };
  workspaceConfig?: any;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Code snapshot + profile (propagated to worker sharedContext in graph.ts).
  // Note: `directive` is inherited from ResolvableState via TriageableState.
  // Document inputs (prd / sources / design / ui) flow through `artifacts` below.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  code?: string;
  codeHead?: string;
  profile?: CodebaseProfile;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unified artifact pool (resolve output, consumed by all downstream nodes)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  artifacts?: ResolvedArtifact[];

  // Per-model job-level usage breakdown (declared channel in graph.ts; the
  // object-config Annotation form is not lifted by StateType, so it is
  // surfaced explicitly here). Basis for USD/credit cost; persisted to the
  // session so completed runs retain it. Aggregate `tokenUsage` is inherited.
  tokenUsageByModel?: TokenUsageByModel;

  // RAC (detect output → decompose enriches basis.techTier: TechTierConfig)
  // Effective TechTier is derived on demand via getTechTier(state) from
  // resolvedAction.basis.techTier. Do not mirror as a top-level field.
  resolvedAction?: ResolvedActionContext;
  resolvedArtifacts?: ResolvedArtifact[];

  /**
   * Phase C — Detect node output cache for escalation reuse.
   *
   * Direct → escalation → decompose re-entry uses this so `inferRacWithTools`
   * does not re-run when the same intent / metadata is in flight. Populated
   * by the unified detect factory; consumed by the same factory's resume
   * fast-path on subsequent passes. Optional because non-escalation flows
   * do not seed it.
   */
  detect?: import('../../../common/graph/nodes/detect/types').DetectResult<ArchitectGraphState>;

  // Decompose clarify: LLM needs user clarification before completing decomposition
  awaitingDecomposeClarify?: boolean;

  // Clarify budget tracking (job-scoped). `clarifyRoundsUsed` bounds re-asks
  // across the whole job; `clarifyPhase` records the emitting phase so the
  // realtime signal + resume can name it. Written only on a clarify pause via
  // the shared `applyClarifyGate` helper. See clarify-policy-matrix (SSOT).
  clarifyRoundsUsed?: number;
  clarifyPhase?: import('@ant/shared').ClarifyPhase;

  // ✅ Reference Requests (registered in decompose, loaded per-task in plan)
  referenceRequests?: Array<{project: string; branch?: string}>;
  
  // Figma MCP metadata — populated by resolve when a figma UiSource is
  // active. Availability itself is derived from
  // `resolvedAction.mcpSources.figma` (SSOT); these scalars are kept because
  // worker subgraphs share them via sharedContext and the tool handler reads
  // `figmaFileKey` from its own ToolExecutionContext.
  figmaFileKey?: string;
  figmaStartNodeId?: string;

  // Dependencies (extends TriageableState.deps)
  deps?: { 
    git?: GitPort;
    fileSystem?: import('../../../../core/ports/filesystem').FileSystemPort;
    memory?: MemoryPort; 
    llm?: LLMClient;
    promptBuilder?: PromptBuilder;
    analyzer?: CodebaseAnalyzerPort;
    chunk?: ChunkPort;
    session?: SessionPort;
    command?: CommandPort;
    retriever?: import('../../../../core/codebase/CodebaseRetriever').CodebaseRetriever;
    vectorDB?: MemoryPort;
    workspaceResolver?: import('../../../../core/config/WorkspacePathResolver').WorkspaceResolver;
    kanbanUpdate?: TaskQueueUpdatePort;
    fileTreeUpdate?: import('../../../../core/ports').FileTreeUpdatePort;
    workflowUpdate?: import('../../../../core/ports').WorkflowStateUpdatePort;
    previewUpdate?: import('../../../../core/ports/preview').PreviewUpdatePort;
    redis?: any;
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  
  // Session Context (compressed for LLM)
  sessionContext?: {
    recentRuns: Array<{
      runId: number;
      directive: string;
      mode: string;
      output: string;
    }>;
    summary?: string;
    totalRuns: number;
    currentRun: number;
    currentMode: string;
    windowSize: number;
    compressionRatio: number;
  };

  // ✅ Asset inventory — domain-scoped enumeration of the feature's asset pool
  // (`assets/{service|game}/**`, path-only — NOT injected to LLM as content).
  // Shared shape with the design job (see infrastructure/workspace/assetInventory.ts).
  // In monorepos/multi-app repos, the correct static root is chosen by the LLM
  // and referenced files are copied by the ui/feature task that needs them.
  // `sizes` / `corrupted` are produced by `indexAssetPool` and were simply not
  // declared here, so a code job could not surface either — a poisoned asset
  // looked identical to a healthy one in the execute prompt even after
  // `valid-crating-prawn` added the detection. Declared now so the execute
  // asset block can label size and defects (level-dashing-plumb).
  assetInventory?: {
    files: string[];                    // feature-relative, e.g. assets/game/entities/hero.png
    groups?: Record<string, string[]>;  // first-subdir grouping under the pool root
    count: number;
    sizes?: Record<string, number>;     // byte size per file — quantifies a binary the LLM cannot read
    corrupted?: Record<string, string>; // defect reason per corrupted binary (utf-8 round-trip / bad header)
  };
  
  // ✅ Revise Support (continue with new directive)
  directives?: string[];  // Multiple directives (newest first = highest priority)

  // Execution
  planText: string;
  codePrompt: string;
  rawResponse: string;
  responseSection?: string | null;
  filesToDelete: string[];
  modifications?: any[];  // For evaluation
  featureName?: string;  // ✅ For buffer manager initialization
  
  // ✅ NEW: LLM Response (tool calling 지원)
  llmResponse?: {
    thinking?: string;
    thinkingSignature?: string;
    textResponse?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, any>;
    }>;
    done: boolean;
    tokenUsage?: TokenUsage;
  };
  
  // ✅ NEW: Tool Results (도구 실행 결과)
  toolResults?: Array<{
    toolCallId: string;
    result: any;
    error?: string;
  }>;
  
  // ✅ REMOVED: fileBuffers (replaced by SharedFileBuffer for cross-worker visibility)
  // SharedFileBuffer is managed at graph level and injected via WorkerFileSystem
  
  // ✅ Unified conversations record (node:execute, node:plan, session:main)
  conversations: Conversations;

  /** Per-task LLM call counter (reset on task transition, used for debug logging) */
  _executeCallIndex?: number;

  /** Which node's tool loop are we in? 'plan' = plan-tool loop, 'execute' = execute-tool loop.
   *  Used by routers (planRouter, toolRouter) and tool node for conversation/tracking branching. */
  _activePhase?: 'plan' | 'execute';
  /**
   * Why did we enter the plan node? Set by `checkTaskStatus` to `'retry'`,
   * consumed immediately on plan entry. `undefined` = fresh task from queue
   * or Tier-2 reverify cycle. Tool-loop re-entry is detected via
   * `_activePhase === 'plan'` and bypasses this channel; Tier-2 self-verify
   * apply→verify transition is detected from observable state by
   * `resolvePlanEntry` (`_activePhase='execute'` + `llmResponse.done` +
   * `requiresVerification(task) && !isVerificationTask(task)` + non-empty
   * `planText`) and likewise bypasses this channel.
   */
  _nextPlanEntry?: PlanEntry;
  /**
   * Turn-scoped signal: did the most recent tool batch (the one that ran
   * just before the current execute turn) mutate any files?
   *
   * SSOT writer: `nodes/tool/index.ts buildReturn` — sets to whether any
   * execute-phase tool batch emitted a `fileModified` / `fileCreated` /
   * `fileDeleted` side effect.
   *
   * Reader: `nodes/execute/index.ts` — the turn-progress signal that
   * suppresses "stuck" classification (and drives remediation
   * auto-complete) on a turn that immediately followed a tool-based file
   * mutation (`edit_file` / `create_file` / `delete_file`).
   *
   * Reset: every execute return path writes `false` so a tool batch that
   * mutated files only counts for ONE subsequent execute turn. Replaces the
   * retired `_executeModifiedFiles` sticky flag (whose dual roles —
   * cross-cycle file change tracking AND turn-progress signal — caused the
   * `urban-fronting-faith` p2 reverify-branch lockout).
   */
  _lastToolBatchMutatedFiles?: boolean;
  /**
   * Turn-scoped signal: was the most recent execute-phase tool batch
   * provably zero-information? Two flavors share the flag:
   *   - ENTIRELY duplicate-elided successful `read_file` calls (by
   *     construction of the execute-then-compare elision), OR
   *   - ENTIRELY errored calls whose command labels already carry a failure
   *     in the pre-batch `commandHistory` (re-issuing calls the model has
   *     already watched fail — trim-grinding-motif RCA).
   *
   * SSOT writer: `nodes/tool/index.ts buildReturn` (execute-phase batches
   * only — mirrors `_lastToolBatchMutatedFiles`). Reader:
   * `computeNextNoProgressStreak` (`nodes/execute/drainFinalize.ts`).
   * Reset: every execute return path writes `false` so a batch only counts
   * for ONE subsequent execute turn.
   */
  _lastToolBatchAllDupReads?: boolean;
  /**
   * No-progress streak: consecutive execute turns with provably zero
   * progress — the fed-by-`_lastToolBatchAllDupReads` counter behind the
   * no-progress circuit breaker (`NO_PROGRESS_HARD_CAP`) and the
   * drain-finalize salvage. Increment/reset rule is single-owned by
   * `computeNextNoProgressStreak`; the execute node commits the result on
   * every return path.
   *
   * Task/attempt boundary resets to 0 (anti-retry-spiral — a missed reset
   * would re-trip the breaker on the retry's first router pass):
   * `checkTaskStatus` success/retry/batch-split returns (both wrappers),
   * `plan/entry/resolve.ts handleRetryEntry`, and `TaskWorker` per-task init
   * — everywhere `_executeCallIndex: 0` is emitted.
   */
  _noProgressStreak?: number;
  /**
   * Rolling window (last 3) of normalized-assistant-text hashes from recent
   * execute turns — the output-side no-progress signal behind the
   * `repeatedIdenticalText` rule in `computeNextNoProgressStreak`
   * (vivid-orbiting-dodge RCA: a degenerate loop can repeat one sentence
   * verbatim while advancing a NOVEL read cursor, so the tool-side
   * `_lastToolBatchAllDupReads` signal stays silent for hundreds of rounds).
   *
   * Writers: helpers in `nodes/execute/drainFinalize.ts`
   * (`computeNextRecentTextHashes` / `isRepeatedAssistantText`); the execute
   * node commits the updated ring on every return path. Resets to `[]` at
   * the same task/attempt boundaries as `_noProgressStreak` (a stale ring
   * would give a retry's first repeated sentence a spurious +1).
   */
  _recentExecuteTextHashes?: string[];
  /**
   * No-forward-output streak: consecutive execute turns that carried tool
   * calls (or ran a tool-stripped salvage turn) but produced NO forward
   * output — no tool mutation, no `<done>`. Behind the
   * `NO_OUTPUT_HARD_CAP` circuit breaker (Safety Net C2) and the shared
   * drain-finalize salvage. Increment/reset rule is single-owned by
   * `computeNextNoOutputStreak` (`nodes/execute/drainFinalize.ts`); the
   * execute node commits it on every return path.
   *
   * SEPARATE from `_noProgressStreak` because `computeNextNoProgressStreak`
   * is shared with the PLAN tool-loop, which legitimately never emits a
   * a file — folding a no-output rule into that shared function would make
   * every plan round accrue it. This channel is execute-only (the plan loop
   * neither writes nor reads it). cyan-catching-cedar RCA: novel line-range
   * re-reads keep `_noProgressStreak` at 0 for 156 rounds; this counter is
   * the "rounds since forward output" signal that catches it.
   *
   * Task/attempt boundary resets to 0 at exactly the same sites as
   * `_noProgressStreak` (everywhere `_executeCallIndex: 0` is emitted) — a
   * missed reset would re-trip the breaker on a retry's first router pass.
   */
  _noOutputStreak?: number;
  /** The drain-salvage allow-list the JUST-RUN execute round actually
   * advertised (drainFinalize `toolChoice.allow`), or null when not draining.
   * The tool node's `gateCall` refuses calls outside it — `{ allow }` only
   * narrows declarations, and OpenAI-compat providers (GLM) keep emitting
   * undeclared history-pattern tools (narrow-ending-flour RCA). */
  _drainSalvageTools?: string[] | null;
  /**
   * Package manager (npm / pnpm / yarn / bun) detected from lockfile at the
   * verification plan entry, cached for the rest of the job.
   *
   * **Scope**: plan-node-internal. Writer: `plan/parts/entry.ts#recomputeInstallNeeded`
   * when `detectPmIfMissing` is set. Readers: verification and error plan
   * prompt builders only. No other node consumes this.
   */
  _detectedPackageManager?: string;
  /**
   * Transient install observation written by `recomputeInstallNeeded` and
   * read once by the verification plan prompt builder. `true` = install
   * needed, `false` = current, `undefined` = unknown / not a JS project.
   * Per-entry only — there is no Session cache.
   */
  _installNeededTransient?: boolean;
  /** Files written by other parallel tasks/workers (for session manifest in execute) */
  _otherWorkerFiles?: Array<{ path: string; taskName?: string }>;
  /**
   * Paths of files that existed under `codebase/` at the moment execute
   * started. Populated from a one-shot `listFiles('codebase', ...)` call.
   * Rendered in `buildTaskInvariantContext` as the `Existing Codebase
   * Files` manifest so the LLM can dispatch between `create_file` (new)
   * and `edit_file` (existing) without fallthrough to `list_files` — the
   * refactor that removed `projectCodeContext` left execute blind here and
   * variant prompts still reference phantom "directory tree" / "retrieved
   * context" sections.
   */
  _existingCodebaseFiles?: string[];

  requiredIntegrations: IntegrationRequirement[];
  violations?: Violation[];  // ✅ 구조화된 violation 배열
  fileErrors?: string[];     // ✅ 파일 작업 실패 에러 메시지 (checkTaskStatus에서 violation으로 변환)

  retries: number;
  maxRetries: number;

  // Progress tracking (for smart retry reset)
  previousFileCount?: number; // Previous file count to detect new files
  
  // Attempt history (to prevent repeating same mistakes)
  previousAttempts?: AttemptHistory[];  // History of what we tried before
  
  // Enforcement feedback history (학습 가능한 피드백)
  enforcementHistory?: EnforcementFeedback[];  // ✅ 모든 enforcement 이력
  
  // Task Queue System (Divide & Conquer)
  taskQueue?: BaseTaskQueue<CodeTask>;    // Priority queue of all tasks
  currentTask?: CodeTask;                 // Currently executing task
  featureTasks?: Map<string, CodeTask>;   // Original feature tasks (for tracking completion)
  completedTasks?: string[];          // Task IDs that finished successfully
  completedTasksDetails?: CodeTask[];     // ✅ NEW: Full task objects of completed tasks (with timing, etc.)
  resolvedCategories?: ErrorCategory[]; // Categories with 0 errors (successfully resolved)
  
  // Failed-task SSOT — markers live on `taskQueue[i]._failed` / `._failureReason`;
  // see `@ant/shared` BaseTaskCommon. There is no separate `failedTasks` channel.

  // ✅ Unresolved Errors (Error Tasks that failed after max retries)
  unresolvedErrors?: Array<{
    taskId: string;
    taskName: string;
    violations: Violation[];
  }>;
  
  subtaskIndex: number;               // Current subtask index (for display)
  totalSubtasks: number;              // Total number of subtasks
  
  // Evaluation
  evaluationReport?: any;
  
  // Lessons (extracted knowledge from task completion)
  lessons?: Array<{
    content: string;
    score: number;
    relatedFiles: string[];
    tags: string[];
    timestamp: string;
    directive?: string;
  }>;
  
  // Results (populated by learn node)
  branch?: string;
  filesWritten?: number;
  reportFile?: string;
  
  /**
   * UI locale narrowed from `TriageableState.uiLocale` to a literal union.
   *
   * - Writer: `triage` node after intent classification; resolved from the
   *   workspace/user preference or the detected language of the directive.
   * - Readers: plan/execute prompt builders (passed as `userLanguage` var to
   *   i18n-aware templates like UI design catalogs).
   * - Reset rule: never reset within a job; carried end-to-end.
   */
  _uiLocale?: 'ko' | 'en';

  /** Batch split occurred: original task was re-enqueued, skip completed marking in checkTaskStatus */
  _batchSplitRequeued?: boolean;

  /**
   * One-shot truncation hint produced by the execute node when an LLM
   * stream cut off with `stopReason === 'max_tokens'` while a create_file
   * or append_file call was still generating its arguments.
   *
   * Lifecycle:
   *   - SET by `nodes/execute/index.ts` on the stream's `done` event, from
   *     the ToolFileStreamer's open-tool-file salvage context.
   *   - READ by `nodes/execute/buildMessages.ts` on the very next execute
   *     entry — folded into the user message that names the path + last
   *     ~240 chars so the LLM can resume via `append_file`.
   *   - CLEARED to `undefined` once the hint has been folded into a
   *     prompt; per-attempt only, never crosses task boundaries.
   *
   * RCA: safe-braking-eagle. A truncated tool call never executes, so
   * nothing reached disk; the hint tells the LLM where the cut was so the
   * next round re-issues the write from a known anchor. See option C in
   * `.claude/plans/safe-braking-eagle-id-code-enchanted-dongarra.md`.
   */
  _maxTokensTruncation?: {
    kind: 'file' | 'append';
    path: string;
    tailContent: string;
  };

  /**
   * Plan-LLM violation framing carried across attempts of the plan-node
   * inline retry loop (decompose's `ExecutionTierViolation` retry pattern,
   * ported for `BatchSplitSchemaViolation`).
   *
   * Lifecycle:
   *   - SET by `plan/index.ts` retry loop after catching a
   *     `BatchSplitSchemaViolation` thrown from `processDiagnosticBatch
   *     Split`. Value is the result of `buildBatchSplitSchemaViolation
   *     Framing(e)`.
   *   - READ by `buildPlanPrompt` — appended to the rendered plan-base
   *     user prompt for the next attempt so the LLM sees exactly which
   *     entry kind / index / field violated the schema.
   *   - CLEARED to `undefined` after the attempt that triggered it
   *     completes (success or final-attempt graceful skip), so leakage
   *     into the next task's plan is impossible.
   *
   * Per-attempt only — there is no Session cache.
   */
  _batchSplitViolationFraming?: string;

  /**
   * Tasks finalised by `batchSplit` Path B (drop-and-replace) inside the
   * current node's execution. Carries each parent task with its `timing`
   * + `tokenUsage` snapshot and `supersededBy` lineage already populated.
   * `checkTaskStatus` (main + worker) drains this channel into the long-
   * lived `completedTasksDetails` (or, in worker context, forwards via
   * `_supersededDetails` → `TaskWorker` → `orchestrator.reportBatchSplit`).
   * Always reset to undefined after consumption so subsequent batch-split
   * cycles do not double-emit the same parent.
   */
  _supersededByBatchSplit?: BaseTask[];

  /**
   * Phase mode signal — `true` when the active task has entered its
   * verify phase. Drives apply-vs-verify hook dispatch in
   * `composeBundle` and the task-type-blind predicate generalisations
   * (e.g. `executeRouter.isFinalTask`).
   *
   * SSOT writer: `tasks/_shared/verify/markVerifyEntered.ts` —
   * `markVerifyEntered(state)` is the only function that flips this
   * channel to `true`. Two call paths, both inside the plan node so the
   * commit happens via the plan-node return delta:
   *
   *   - Tier 3/4 verification task: `nodes/plan/entry/resolve.ts::
   *     handleFreshTaskEntry` calls it on every fresh plan entry where
   *     `isVerificationTask(task)`.
   *   - Tier 2 self-verify task (`selfVerifyOnDone:true`):
   *     `nodes/plan/entry/resolve.ts::handleReverifyEntry` calls it on
   *     the apply→verify boundary and every subsequent reverify cycle.
   *     The boundary is detected from observable state — no transient
   *     flag is needed.
   *
   * Plus `runner.ts` resume restoration writes it on the **input** state
   * before `graph.invoke()` so a resumed mid-reverify session enters in
   * the right hook surface.
   *
   * Reset to `false` at task boundary in `nodes/checkTaskStatus`.
   * External mutation outside the helper is forbidden (regression
   * test enforces). `undefined` is treated as `false`.
   *
   * ⚠️ Never flip from a LangGraph conditional-edge function — those
   * mutations are read fresh from channels and silently discarded
   * (see `markVerifyEntered.ts` anti-pattern note).
   */
  _verifyEntered?: boolean;

  /** Phase 3-15 — number of `search_web` calls executed in the current
   *  plan-toolLoop session. Reset on fresh task entry; incremented after
   *  each plan-phase `search_web` execution. Cap enforced in `handleSearchWeb`
   *  via `ctx.planSearchWebLimit` (default 3, env `ANT_PLAN_SEARCH_WEB_MAX`). */
  _planSearchWebCount?: number;

  /** Sibling of `_planSearchWebCount` for the `fetch_url` tool. Reset on fresh
   *  task entry; incremented after each plan-phase `fetch_url` execution. Cap
   *  enforced in `handleFetchUrl` via `ctx.planFetchUrlLimit` (default 5, env
   *  `ANT_PLAN_FETCH_URL_MAX`). */
  _planFetchUrlCount?: number;

  /**
   * Command history (loop detection). Single writer: the tool node's
   * `afterBatch` hook, which RETURNS the appended array via
   * `hookUpdates.commandHistory` so the channel actually commits — in-place
   * `state.commandHistory.push(...)` never survives a superstep (the channel
   * stayed `undefined` forever and Safety Net B / the loop-detection warning
   * / the dominant-failure diagnostic were structurally dead;
   * trim-grinding-motif RCA). Pruned to a 5-minute window + 100 entries by
   * `appendCommandHistory`. Readers: `detectRecentToolFailures`
   * (executeRouter Safety Net B), `summarizeDominantFailure` /
   * `summarizeDominantRepeatedCommand` (checkTaskStatus),
   * `isAllRepeatErrorBatch` / `isAllRepeatCommandBatch` (tool node).
   */
  commandHistory?: Array<{
    command: string;
    timestamp: number;
    success: boolean;
    exitCode?: number;
    errorSnippet?: string;
    /**
     * Volatile-numeral-masked FNV-1a hash of the command's output
     * (`hashCommandOutput`). Lets `isAllRepeatCommandBatch` detect a
     * SUCCESSFUL command re-run whose output is identical — the
     * shy-crushing-bloom blind spot (357 identical passing-exit-code test
     * re-runs that every failure-gated brake ignored).
     */
    outputHash?: string;
  }>;
  
  /**
   * Per-task token accumulator.
   *
   * - Writer: `llmHelpers` accumulates LLM call token usage after each call
   *   within the current task.
   * - Readers: `TaskTimingHelper.completeTask` snapshots it onto the task's
   *   `tokenUsage` field; reporting/kanban read the task's snapshot.
   * - Reset rule: `resetTaskTokenUsage(state)` on every fresh task entry
   *   (and on retry before the first LLM call of the new attempt).
   */
  _currentTaskTokenUsage?: TokenUsage;

  /**
   * Per-task per-model token usage — the model-partitioned twin of
   * `_currentTaskTokenUsage`. Reset per task at the worker boundary so the
   * worker reports a clean per-task DELTA the orchestrator sums job-level for
   * per-model billing. SSOT symmetry with the aggregate counter above.
   */
  _currentTaskTokenUsageByModel?: TokenUsageByModel;

  /**
   * Token usage snapshot captured at the end of the decompose phase, before
   * the first task runs. Used to report "estimating phase" tokens separately
   * from task tokens in the final summary.
   *
   * - Writer: end of decompose node, once.
   * - Readers: report generation (learn node).
   * - Reset rule: set once per job; never reset thereafter.
   */
  _estimatingTokenUsage?: TokenUsage;
  
  // ✅ Recursion tracking
  recursionCount?: number;  // Current iteration count
  recursionLimit?: number;  // Maximum allowed iterations
  
  // ✅ Interruption tracking
  interruption?: import('../../../../core/types').InterruptionDetails;  // Details about why and how the job was interrupted
  
  // ✅ Running Servers (for automatic cleanup)
  runningServers?: Array<{
    pid: number;
    command: string;
    workingDir: string;
    port?: number;
    startedAt: number;
  }>;

  // ✅ Job tracking (for timing and continuity)
  jobId?: string;
  jobTiming?: import('../../../common/graph/timing/JobTimingManager').JobTiming;

  /**
   * Current user turn id (session redesign §2 — append-only user_turn).
   * Populated by resolve after reading feature.jsonl (matches on jobId);
   * consumed by tool/direct/learn nodes to attribute trace events and
   * breadcrumb/boundary lines to the originating user request.
   */
  turnId?: string;

  // ✅ Worker runtime injection
  workerId?: number;
  _isStopRequested?: (() => boolean);

  // Inter-Job Context Bridge
  boundary?: Boundary;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Session Redesign (5-Tier Execution Model)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 5-tier execution strategy selected by the Tier Entry Node LLM
   * (`<executionTier>` tag from Decompose). SSOT for routing, loop limits,
   * breadcrumb / boundary / compact strategy selection.
   *
   *   Tier 0 Reflex       → direct path, read-only textual answer (explain only)
   *   Tier 1 OneShot      → direct path, verification-unneeded single write (up to 2 steps)
   *   Tier 2 Exploratory  → task path, exactly 1 task with selfVerifyOnDone
   *   Tier 3 Task         → task path, >= 2 tasks with mandatory verification task
   *   Tier 4 RefsGrounded → task path, >= 2 tasks anchored in a reference document
   *
   * Mode-specific minimum (enforced by `validateExecutionTier`):
   *   - explain: Tier 0 allowed
   *   - generate / refactor: Tier 1 minimum (Tier 0 forbidden — see the
   *     decompose rules.md matrix). Violations raise `ExecutionTierViolation`
   *     inside decompose's inline retry loop.
   *
   * - Writer: decompose node parses `<executionTier>` from the LLM response
   *   via `parseExecutionTierTag` and validates via `validateExecutionTier`.
   *   There is no silent fallback — a missing/forbidden value triggers retry
   *   and, on exhaustion, fails the job loudly.
   * - Readers: `routeAfterDecompose`, `direct` node, learn / breadcrumb policy,
   *   all phase nodes via `getExecutionTier(state)`.
   * - Reset rule: never reset within a job; re-decompose overwrites.
   */
  executionTier?: ExecutionTierId;

  /**
   * Code-job Tier 3 cross-task analysis brief — sealed by Decompose.
   *
   * Tier 3 has no external reference document, so the only cross-task
   * carrier of "macro goal / cross-cutting concerns / decomposition
   * rationale / (error case) diagnosis + solution direction" is this
   * channel. Every per-task `plan` node reads it via prompt vars
   * (`analysis` / `hasAnalysis`) and uses it to keep each task's
   * solution aligned with the job-level intent.
   *
   * - Writer: `decompose` parses `<analysis>...</analysis>` from the LLM
   *   response and assigns when `executionTier === 3`. Missing at Tier 3
   *   triggers an inline retry framing. Forbidden at Tier 4 (the ref
   *   document is the SSOT). Skipped at Tier 0 / 1 / 2.
   * - Readers: every per-task `plan` invocation, via `buildPlanPrompt`
   *   threading `state.analysis` into Handlebars vars.
   * - Reset rule: never reset within a job; re-decompose overwrites.
   */
  analysis?: string;

  /**
   * Hints produced by Decompose for the `direct` node (Tier 0 / Tier 1 paths).
   * `targetFiles` applies when concrete targets are identifiable from
   * directive+context (generate/refactor at Tier 1). `explorationScope`
   * narrows the ReAct observation surface when the directive calls for it.
   * Tier 2+ routes to the task pipeline and does not consume `directHints`.
   */
  directHints?: { targetFiles?: string[]; explorationScope?: string };

  /**
   * T2+T3 context loaded from feature.jsonl by resolve (session redesign).
   * Populated by `resolve_integrate` (§11) and optionally compacted by §13
   * `compactFeatureContext`. Consumers: plan/direct prompt builders.
   *
   * Shape SSOT lives in `core/context/featureContextBuilder.ts`
   * (`FeatureContext` — includes `summary?` / `wasCompacted?` populated by
   * Compact). Do not redeclare inline here; drift between the builder and
   * this state channel silently breaks the `{{#if featureContext.summary}}`
   * handlebars block in plan/direct base templates.
   */
  featureContext?: FeatureContext;

  /**
   * Spec clarify choice emitted by Decompose when:
   *   tier >= 3 (Task or RefsGrounded) && mode !== 'explain'
   *   && no system design doc && no relevant spec
   * When present, graph routes to `__end__` to await user choice.
   * Triggering logic lives in the decompose prompt's Spec Clarify
   * section; this channel carries the LLM's emitted `<specClarify>`
   * payload for the router.
   */
  specClarify?: SpecClarify;

  /**
   * Runtime escalation guard: the `direct` node may re-enter `decompose`
   * at most once per job. Flips false→true at direct's **next entry**
   * after a prior escalation (i.e. when `state.needsEscalation === true`
   * is already visible on entry), NOT at the first escalation return —
   * that would close `routeAfterDirect`'s `!_promotedThisJob` branch
   * before decompose gets a chance to re-plan. On the second escalation
   * (if any) `routeAfterDirect` sees `_promotedThisJob === true` and
   * routes to `learn`, enforcing the 1-shot cap. See
   * `nodes/direct/index.ts` (`wasEscalationReentry`) for the transition.
   */
  _promotedThisJob?: boolean;

  /**
   * Set when the user selects "proceed without spec" on a specClarify
   * prompt. Decompose reads this on re-entry and skips the specClarify
   * trigger so the same job can proceed without design redirect.
   */
  _specClarifyBypassed?: boolean;

  /**
   * Direct-node driven escalation signal: when the direct ReAct loop
   * determines the scope exceeds oneshot/exploratory bounds, it sets this
   * flag and returns; `routeAfterDirect` then promotes back to decompose.
   */
  needsEscalation?: boolean;
}

/**
 * Task Timing Helper Functions
 */
export class TaskTimingHelper {
  /**
   * Start timing for a task
   */
  static startTask<T extends { timing?: CodeTask['timing'] }>(task: T): T {
    const now = new Date().toISOString();

    if (!task.timing) {
      // First time starting
      return {
        ...task,
        timing: {
          startedAt: now,
          totalPausedDuration: 0
        }
      };
    }
    
    // Resuming from pause
    if (task.timing.pausedAt) {
      const pausedDuration = new Date().getTime() - new Date(task.timing.pausedAt).getTime();
      return {
        ...task,
        timing: {
          ...task.timing,
          resumedAt: now,
          totalPausedDuration: task.timing.totalPausedDuration + pausedDuration,
          pausedAt: undefined
        }
      };
    }
    
    return task;
  }

  /**
   * Re-start timing for a task from scratch. Unlike `startTask`, this always
   * resets `timing` (discarding any stale `startedAt` from a previous
   * assignment). Used by TaskOrchestrator to prevent cumulative elapsed
   * time across sequential assignments of the same task instance.
   */
  static restartTask<T extends { timing?: CodeTask['timing'] }>(task: T): T {
    return {
      ...task,
      timing: {
        startedAt: new Date().toISOString(),
        totalPausedDuration: 0,
      },
    };
  }

  /**
   * Pause timing for a task (recursion limit, etc.)
   *
   * Generic over the task variant — operates only on `timing` and works
   * for both CodeTask and DesignTask. The discriminated-union narrowing
   * is irrelevant here.
   */
  static pauseTask<T extends { timing?: CodeTask['timing'] }>(task: T): T {
    if (!task.timing) {
      console.warn('[TaskTiming] Cannot pause task without timing info');
      return task;
    }

    return {
      ...task,
      timing: {
        ...task.timing,
        pausedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Complete timing for a task. Generic over task variant — works for
   * both CodeTask and DesignTask.
   */
  static completeTask<T extends { timing?: CodeTask['timing']; completed?: boolean; tokenUsage?: TokenUsage }>(
    task: T,
    tokenUsage?: TokenUsage,
  ): T {
    if (!task.timing?.startedAt) {
      console.warn('[TaskTiming] Cannot complete task without start time');
      return { ...task, completed: true, tokenUsage };
    }
    
    const completedAt = new Date().toISOString();
    const totalTime = new Date(completedAt).getTime() - new Date(task.timing.startedAt).getTime();
    const elapsedTime = totalTime - task.timing.totalPausedDuration;
    
    return {
      ...task,
      completed: true,
      timing: {
        ...task.timing,
        completedAt,
        elapsedTime
      },
      tokenUsage  // ✅ Include token usage
    };
  }
  
  /**
   * Format elapsed time as human-readable string
   */
  static formatElapsedTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
}
