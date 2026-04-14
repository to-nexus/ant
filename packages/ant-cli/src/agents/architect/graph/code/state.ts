import { CodebaseProfile } from "../../../../core/types";
import type { ParsedUiDocs } from "../../../../core/types/uiDoc";
import type { ConversationEntry } from "../../../../core/types/session";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort, TaskQueueUpdatePort } from "../../../../core/ports";
import type { PromptBuilder } from "../../../../core/prompt/builder/PromptBuilder";
import { ProjectContext } from "../../types";
import { ProjectCodeContext, ReferenceCodeContext } from "../../../../core/prompt/types/CodeContext";
import { CodeTask, TaskQueue as BaseTaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { TriageableState } from '../../../common/graph/nodes/triage/types';
import type { ResolvedActionContext, ResolvedArtifact, TechTier, Boundary } from '@ant/shared';

export interface IntegrationRequirement {
  name: string;
  type?: 'database' | 'api' | 'auth' | 'other';
  description?: string;
}

/**
 * Verification objective tracker.
 * Tracks whether build and test commands have succeeded,
 * reset when files are modified to force re-verification.
 */
export interface VerificationTracker {
  buildPassed: boolean;
  testPassed: boolean;
  testsRequired: boolean;
  /** Plan tool loop guard: tracks whether each verification command type has been attempted. */
  buildAttempted?: boolean;
  testAttempted?: boolean;
  /** Static type check (tsc --noEmit) — separate from build to avoid tracker conflation. */
  typecheckPassed?: boolean;
  typecheckAttempted?: boolean;
  typecheckRequired?: boolean;
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
  // Legacy artifact fields (previously inherited, now declared directly)
  // Note: `directive` is inherited from ResolvableState via TriageableState.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  prd?: string;
  sourceDocuments?: Record<string, string>;
  design?: string;
  designDocPath?: string;
  code?: string;
  codeHead?: string;
  parsedUiDocs?: ParsedUiDocs;
  profile?: CodebaseProfile;
  hasUiDoc?: boolean;
  isSpecDriven?: boolean;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unified artifact pool (resolve output, consumed by all downstream nodes)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  artifacts?: ResolvedArtifact[];

  // RAC (detect output, immutable) + TechTier (decompose output)
  resolvedAction?: ResolvedActionContext;
  resolvedArtifacts?: ResolvedArtifact[];
  techTier?: TechTier;

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
  
  // ✅ NEW: Conversation History (멀티턴 대화)
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string | import('../../../../core/ports/llm').MessageContentBlock[];
  }>;

  /** Per-task LLM call counter (reset on task transition, used for debug logging) */
  _executeCallIndex?: number;

  /** Per-task execute call budget computed from planText (create×1 + modify×3). Undefined = use default. */
  _executeBudget?: number;

  /** Counter for consecutive final-task iterations with no done and no tool calls (Safety Net C) */
  _finalTaskLoopCount?: number;

  /** Which node's tool loop are we in? 'plan' = plan-tool loop, 'execute' = execute-tool loop.
   *  Used by routers (planRouter, toolRouter) and tool node for conversation/tracking branching. */
  _activePhase?: 'plan' | 'execute';
  /** Why did we enter the plan node? Set by the caller (executeRouter, enforce, etc.),
   *  consumed immediately on plan entry. Undefined = new task from queue. */
  _planEntryReason?: 'retry' | 'reverify';
  /** Tracks whether execute phase modified any files (for executeRouter re-verify decision) */
  _executeModifiedFiles?: boolean;
  /** Whether dependency install is needed (dep-hash guard bypass) */
  _installNeeded?: boolean;
  /** Accumulated remediation plans from previous fix cycles */
  _appliedPlanHistory?: string[];
  /** Files written by other parallel tasks/workers (for session manifest in execute) */
  _otherWorkerFiles?: Array<{ path: string; taskName?: string }>;
  /** Plan-phase conversation only (separate from execute conversationHistory) */
  planConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string | import('../../../../core/ports/llm').MessageContentBlock[] }>;

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
  
  // ✅ UI locale (narrowed from TriageableState.string to literal union)
  _uiLocale?: 'ko' | 'en';
  
  // ✅ Error repetition tracking (internal)
  _errorIsRepeating?: boolean;  // Flag to indicate if errors are repeating

  /** Batch split occurred: original task was re-enqueued, skip completed marking in checkTaskStatus */
  _batchSplitRequeued?: boolean;
  
  // ✅ Verification objective tracker (build/test pass status, reset on file modification)
  _verificationTracker?: VerificationTracker;

  /** Hash of dependency declaration files at last successful install.
   *  Compared at verification plan entry to determine if install is needed. */
  _depFileHash?: string;

  // ✅ Command history tracking (for loop detection)
  commandHistory?: Array<{
    command: string;
    timestamp: number;
    success: boolean;
    exitCode?: number;
    errorSnippet?: string;
  }>;
  
  // ✅ Token tracking for current task (internal, accumulated across LLM calls within a task)
  _currentTaskTokenUsage?: TokenUsage;
  
  // ✅ Estimating phase token usage snapshot (captured at end of decompose, before tasks)
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

  // ✅ Worker runtime injection
  workerId?: number;
  _isStopRequested?: (() => boolean);

  // ✅ Docker infrastructure cleanup (runner-injected, not serializable)
  _infraManager?: any;
  _infraProjectPath?: string;

  // Inter-Job Context Bridge
  boundary?: Boundary;
  jobConversation?: ConversationEntry[];
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
   * Get current elapsed time for a running task
   */
  static getCurrentElapsedTime(task: CodeTask): number | null {
    if (!task.timing?.startedAt) {
      return null;
    }
    
    // If paused, calculate up to pause time
    if (task.timing.pausedAt) {
      const totalTime = new Date(task.timing.pausedAt).getTime() - new Date(task.timing.startedAt).getTime();
      return totalTime - task.timing.totalPausedDuration;
    }
    
    // If running, calculate up to now
    const totalTime = new Date().getTime() - new Date(task.timing.startedAt).getTime();
    return totalTime - task.timing.totalPausedDuration;
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
