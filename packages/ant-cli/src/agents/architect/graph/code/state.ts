import { CodebaseProfile } from "../../../../core/types";
import type { Conversations } from '../../../common/graph/conversations';
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort, TaskQueueUpdatePort } from "../../../../core/ports";
import type { PromptBuilder } from "../../../../core/prompt/builder/PromptBuilder";
import { ProjectContext } from "../../types";
import { ProjectCodeContext, ReferenceCodeContext } from "../../../../core/prompt/types/CodeContext";
import { CodeTask, TaskQueue as BaseTaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { TriageableState } from '../../../common/graph/nodes/triage/types';
import type { ResolvedActionContext, ResolvedArtifact, Boundary, SpecClarify } from '@ant/shared';
import type { ExecutionTierId } from "../../../../core/executionTier";
import type { FeatureContext } from "../../../../core/context/featureContextBuilder";
import type { VerificationSession } from "./tasks/verification/model/Session";
// `PlanEntry` is phase-blind (consumed by router/plan/enforce regardless of
// task type). Source it from the `_shared/` layer so `state.ts` does not
// inherit a structural dependency on the verification-specific model.
import type { PlanEntry } from "./tasks/_shared/types";

export interface IntegrationRequirement {
  name: string;
  type?: 'database' | 'api' | 'auth' | 'other';
  description?: string;
}

/**
 * Structured Violation - 정형화된 에러 정보
 * 학습 및 분석 가능한 형태로 설계
 */
export interface Violation {
  type: ViolationType;           // 에러 타입 (카테고리)
  severity: 'critical' | 'major' | 'minor';  // 심각도
  file?: string;                 // 관련 파일
  message: string;               // 에러 메시지
  suggestedFix?: string;         // 제안된 해결 방법
  isRetryable?: boolean;         // 재시도로 해결 가능한지
  module?: string;               // 관련 모듈 (missing_dependency인 경우)
  errorCode?: string;            // 에러 코드 (있으면)
  metadata?: any;                // ✅ 추가 메타데이터 (에러 통계 등)
}

/**
 * Violation Types - 에러 타입 분류
 */
export type ViolationType = 
  | 'ellipsis'              // 코드에 ... 포함
  | 'excessive_deletion'    // 과도한 삭제
  | 'missing_dependency'    // 의존성 누락
  | 'missing_file'          // 필수 파일 누락
  | 'missing_static_asset'  // 정적 에셋 경로가 public/static root에 없음 (런타임 404 유발)
  | 'type_error'            // TypeScript 타입 에러
  | 'import_error'          // Import 에러
  | 'syntax_error'          // 문법 에러
  | 'build_error'           // 빌드 에러
  | 'lint_error'            // Lint 에러
  | 'config_error'          // 설정 파일 에러
  | 'config_incompatibility' // 프레임워크 설정 비호환 (e.g., Next.js Image Optimization + output:export)
  | 'environment_issue'     // 환경 설정 문제 (NODE_ENV, PATH 등)
  | 'no_files'              // 파일 생성 안 됨
  | 'file_operation_failed' // 파일 작업 실패 (edit search block not found 등)
  | 'cross_worker_conflict' // 병렬 작업 간 파일 충돌 (다른 워커가 이미 생성/수정)
  | 'budget_exhausted'      // execute call limit 도달 (LLM이 <done> 없이 budget 소진)
  | 'verification_incomplete' // verification 태스크가 done 신호를 보냈으나 성공한 빌드 커맨드가 없음
  | 'other';                // 기타

/**
 * Task Priority Mapping
 * Lower number = higher priority (executed first).
 * Each phase occupies a 100-boundary for clean separation.
 */
export const TASK_PRIORITIES = {
  // Setup (100-189)
  SETUP_PROJECT: 100,
  SETUP_MAX: 189,

  // Design-System + Shared Foundation (200-299) — visual infrastructure + shared types/interfaces
  SHARED_FOUNDATION: 200,
  FOUNDATION_MAX: 299,

  // Feature (300-599) — headless skeleton implementation
  FEATURE_CRITICAL: 300,
  FEATURE_IMPORTANT: 350,
  FEATURE_NORMAL: 400,
  FEATURE_NICE_TO_HAVE: 500,
  FEATURE_MAX: 599,

  // Integration (600-649) — wires feature outputs into shared entry points
  INTEGRATION_MIN: 600,
  INTEGRATION_MAX: 649,

  // Visual Pass (650-699) — apply styles to skeleton
  VISUAL_PASS: 650,
  VISUAL_MAX: 699,

  // Post-Feature (700-899) — observe completed feature code, barrier-enforced
  TEST_GENERATION: 700,
  DOCUMENTATION: 800,

  // Error (900-999)
  ERROR_MISSING_ENTRY: 900,
  ERROR_MISSING_DEPS: 905,
  ERROR_CONFIG: 910,
  ERROR_TYPE: 920,
  ERROR_IMPORT: 925,
  ERROR_BUILD: 930,
  ERROR_SYNTAX: 940,
  ERROR_LINT: 960,
  ERROR_OTHER: 980,

  // Final Verification (1000)
  FINAL_VERIFICATION: 1000,
} as const;

export type ErrorCategory = 
  | 'missing_files'       // Missing required files (index.html, etc)
  | 'missing_deps'        // Missing npm packages
  | 'type_errors'         // TypeScript type errors
  | 'config_errors'       // Configuration issues
  | 'import_errors'       // Import path errors
  | 'syntax_errors'       // Syntax errors
  | 'other';              // Uncategorized

/**
 * Enforcement Feedback - 실패 시 학습 가능한 피드백
 */
export interface EnforcementFeedback {
  taskId: string;                    // 어떤 task에서 발생했는지
  taskName: string;
  attemptNumber: number;             // 몇 번째 시도인지
  violations: Violation[];           // 발생한 에러들 (구조화된 형식)
  fixStrategy: 'retry' | 'add_tasks' | 'skip';  // 어떤 전략을 선택했는지
  addedTasks?: CodeTask[];               // 추가된 에러 태스크 (add_tasks인 경우)
  timestamp: number;                 // 언제 발생했는지
}

export interface AttemptHistory {
  attemptNumber: number;           // Which attempt this was (1, 2, 3...)
  filesGenerated: string[];        // List of files created/modified
  keyChanges: string[];            // Human-readable summary of changes
  subtaskName?: string;            // Which subtask this was for (if any)
  errorsAttemptedToFix: string[];  // Which errors this attempt tried to fix
}

// ✅ REMOVED: GeneratedFile interface (replaced by projectCodeContext.files)
// projectCodeContext.files uses: Array<{ path: string; content: string }>

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];  // ✅ 구조화된 violation
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

  // RAC (detect output → decompose enriches basis.techTier: TechTierConfig)
  // Effective TechTier is derived on demand via getTechTier(state) from
  // resolvedAction.basis.techTier. Do not mirror as a top-level field.
  resolvedAction?: ResolvedActionContext;
  resolvedArtifacts?: ResolvedArtifact[];

  selectedDesignFiles?: string[];
  decomposeFilePaths?: string[];
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ✅ REFACTORED: Unified code context structure
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  projectCodeContext?: ProjectCodeContext;      // Main project code
  referenceCodeContexts: ReferenceCodeContext[]; // Reference projects
  
  // ✅ Design Documents — unified map-only structure
  // All docs use {type}-{name}.md pattern (single="main", MSA=service name)
  designDocs?: {
    apiContracts: { [name: string]: string };
    feDesigns: { [name: string]: string };
    beDesigns: { [name: string]: string };
  };
  
  // ✅ Spec Documents (loaded in resolve, selected in decompose, injected in plan)
  specDocs?: Record<string, string>;   // All spec-*.md files (filename → content)
  selectedSpec?: string | null;        // Spec filename chosen by decompose LLM (e.g., "spec-social-login.md")

  // Decompose clarify: LLM needs user clarification before completing decomposition
  awaitingDecomposeClarify?: boolean;

  // ✅ Reference Requests (registered in decompose, loaded per-task in plan)
  referenceRequests?: Array<{project: string; branch?: string}>;
  
  // Design-prescribed dependencies (extracted by decompose LLM via <prescribedDependencies> tag, injected into plan prompts)
  designDocUnknownPackages?: string[];
  
  // Figma MCP state
  figmaAvailable?: boolean;
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

  // ✅ UI Runtime Assets (opt-in copy/sync)
  // - inputs/assets/** are runtime assets (NOT injected to LLM).
  // - In monorepos/multi-app repos, the correct static root must be chosen by the LLM and copied as a task.
  runtimeAssetsIndex?: {
    files: string[]; // paths relative to feature root (e.g., inputs/assets/icons/x.svg)
    count: number;
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

  /** Per-task execute call budget computed from planText (create×1 + modify×3). Undefined = use default. */
  _executeBudget?: number;

  /** Counter for consecutive final-task iterations with no done and no tool calls (Safety Net C) */
  _finalTaskLoopCount?: number;

  /** Which node's tool loop are we in? 'plan' = plan-tool loop, 'execute' = execute-tool loop.
   *  Used by routers (planRouter, toolRouter) and tool node for conversation/tracking branching. */
  _activePhase?: 'plan' | 'execute';
  /**
   * Why did we enter the plan node? Set by the caller (executeRouter, enforce,
   * etc.), consumed immediately on plan entry. Undefined = new task from queue.
   *
   * Renamed from `_planEntryReason` in T4a (task domain consolidation). The
   * union (`PlanEntry`) is sourced from `tasks/_shared/types.ts` — phase-blind
   * by design so non-verification task types can adopt the wider vocabulary
   * (`fresh | resumed | toolLoop`) without coupling state.ts to the
   * verification model. Callers may still write `'retry' | 'reverify'` today;
   * `'fresh' / 'resumed' / 'toolLoop'` are reserved for hook-layer producers
   * landing alongside T5/T6.
   */
  _nextPlanEntry?: PlanEntry;
  /** Tracks whether execute phase modified any files (for executeRouter re-verify decision) */
  _executeModifiedFiles?: boolean;
  /**
   * Package manager (npm / pnpm / yarn / bun) detected from lockfile at the
   * verification plan entry, cached for the rest of the job.
   *
   * **Scope**: plan-node-internal. Writer: `plan/parts/entry.ts#recomputeInstallNeeded`
   * when `detectPmIfMissing` is set. Readers: verification and error plan
   * prompt builders only. No other node consumes this.
   */
  _detectedPackageManager?: string;
  /** Files written by other parallel tasks/workers (for session manifest in execute) */
  _otherWorkerFiles?: Array<{ path: string; taskName?: string }>;

  requiredIntegrations: IntegrationRequirement[];
  violations?: Violation[];  // ✅ 구조화된 violation 배열
  violationMessage?: string; // ✅ enforce node에서 생성한 강화된 violation 메시지 (promptBuilder에서 사용)
  fileErrors?: string[];     // ✅ 파일 작업 실패 에러 메시지 (checkTaskStatus에서 violation으로 변환)

  retries: number;
  maxRetries: number;
  
  // Progress tracking (for smart retry reset)
  lastViolations?: Violation[];  // ✅ 구조화된 이전 violations
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
  verifiedTasks?: Map<string, { passed: boolean; timestamp: string; errors?: string[] }>;  // ✅ Verification cache
  resolvedCategories?: ErrorCategory[]; // Categories with 0 errors (successfully resolved)
  
  // ✅ Failed Tasks (deferred to Final Verification)
  failedTasks?: Array<{
    taskId: string;
    taskName: string;
    taskType: 'setup' | 'feature' | 'design-system' | 'ui' | 'test-code' | 'verification' | 'doc';
    priority: number;
    violations: Violation[];
    timestamp: string;
  }>;
  
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
   * SSOT for verification domain state (attempts, gate config, pass cache,
   * plan history, dep hash, batch-split counter). Populated by
   * `tasks/verification/hooks/plan.ts::initSession` on fresh plan entry,
   * rehydrated on resume via `VerificationSession.rehydrate(snap)`, and
   * carried across worker boundaries as `VerificationSnapshot` in
   * `WorkerSnapshot.verification` / `CodeTaskResumeState.verification`.
   *
   * `undefined` for non-verification tasks — queries go through the
   * Session API (`state.verification?.method()`) and short-circuit
   * naturally.
   */
  verification?: VerificationSession;

  /**
   * Reason emitted by the plan node when it short-circuits before execute
   * (empty plan, already-complete verification, force-split). Consumed by
   * `routeAfterPlan` in lieu of the previous inline `state.llmResponse`
   * mutation inside the router (R1 — routers stay pure).
   *
   * Set by `nodes/plan/parts/handleShortCircuit` (T6) alongside
   * `llmResponse = { done: true, … }`; cleared on the next plan entry.
   */
  _shortCircuitReason?: string;

  /** Phase 3-15 — number of `search_web` calls executed in the current
   *  plan-toolLoop session. Reset on fresh task entry; incremented after
   *  each plan-phase `search_web` execution. Cap enforced in `handleSearchWeb`
   *  via `ctx.planSearchWebLimit` (default 3, env `ANT_PLAN_SEARCH_WEB_MAX`). */
  _planSearchWebCount?: number;

  // ✅ Command history tracking (for loop detection)
  commandHistory?: Array<{
    command: string;
    timestamp: number;
    success: boolean;
    exitCode?: number;
    errorSnippet?: string;
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
   *   Tier 0 Reflex       → direct path, read-only (explain × oneshot)
   *   Tier 1 OneShot      → direct path, 1-2 step ReAct
   *   Tier 2 Exploratory  → direct path, multi-step ReAct
   *   Tier 3 Task         → plan / execute pipeline (directive-only task)
   *   Tier 4 RefsGrounded → plan / execute pipeline (refs-grounded task)
   *
   * - Writer: decompose node (LLM output) or `selectExecutionTier` fallback.
   * - Readers: `routeAfterDecompose`, `direct` node, learn / breadcrumb policy,
   *   all phase nodes via `getExecutionTier(state)`.
   * - Reset rule: never reset within a job; re-decompose overwrites.
   */
  executionTier?: ExecutionTierId;

  /**
   * Hints produced by Decompose for the `direct` node (Tier 0-2 paths).
   * `targetFiles` applies when concrete targets are identifiable from
   * directive+context (generate/refactor). `explorationScope` narrows the
   * ReAct observation surface for exploratory tiers.
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
   *   complexity === 'task' && mode !== 'explain'
   *   && no system design doc && no relevant spec
   * When present, graph routes to `__end__` to await user choice.
   * Triggering logic belongs to `decompose_spec_clarify` (next todo);
   * this channel exists so the parser/router can already carry the value.
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
  static startTask(task: CodeTask): CodeTask {
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
   */
  static pauseTask(task: CodeTask): CodeTask {
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
   * Complete timing for a task
   */
  static completeTask(task: CodeTask, tokenUsage?: TokenUsage): CodeTask {
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
