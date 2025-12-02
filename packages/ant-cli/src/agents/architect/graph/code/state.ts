import { CodeMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { ProjectCodeContext, ReferenceCodeContext } from "../../../../core/prompt/types/CodeContext";

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
  | 'type_error'            // TypeScript 타입 에러
  | 'import_error'          // Import 에러
  | 'syntax_error'          // 문법 에러
  | 'build_error'           // 빌드 에러
  | 'lint_error'            // Lint 에러
  | 'config_error'          // 설정 파일 에러
  | 'environment_issue'     // 환경 설정 문제 (NODE_ENV, PATH 등)
  | 'no_files'              // 파일 생성 안 됨
  | 'other';                // 기타

/**
 * Task Priority Mapping - 우선순위 상수
 * Lower number = higher priority (executed first)
 * NEW POLICY: Features first, then errors (defer error fixing until all features are implemented)
 */
export const TASK_PRIORITIES = {
  // Setup Tasks (100-149) - project initialization
  SETUP_PROJECT: 100,           // Config files, package.json, tsconfig.json (최우선!)
  
  // Feature Tasks (200-899) - implement all features first
  FEATURE_CRITICAL: 200,        // 가장 중요한 기능
  FEATURE_IMPORTANT: 220,
  FEATURE_NORMAL: 250,
  FEATURE_NICE_TO_HAVE: 280,    // 가장 덜 중요한 기능
  
  // Error Tasks (900-999) - fix errors after all features are implemented
  ERROR_MISSING_ENTRY: 900,     // index.html 같은 entry 파일 (가장 중요)
  ERROR_MISSING_DEPS: 905,      // package 의존성
  ERROR_CONFIG: 910,            // tsconfig.json 등
  ERROR_TYPE: 920,              // TypeScript 타입 에러
  ERROR_IMPORT: 925,            // Import 에러
  ERROR_BUILD: 930,             // 빌드 에러
  ERROR_SYNTAX: 940,            // 문법 에러
  ERROR_LINT: 960,              // Lint 에러
  ERROR_OTHER: 980,             // 기타
  
  // Final Verification (1000) - after everything is complete
  FINAL_VERIFICATION: 1000,     // 최종 검증
} as const;

/**
 * Task Timing Information
 * Tracks execution time for each task
 */
export interface TaskTiming {
  startedAt?: string;              // ISO timestamp when task started
  completedAt?: string;            // ISO timestamp when task completed
  pausedAt?: string;               // When paused (recursion limit, etc.)
  resumedAt?: string;              // When resumed
  totalPausedDuration: number;     // Total paused time in milliseconds
  elapsedTime?: number;            // Total elapsed time in milliseconds (excluding paused time)
}

export interface Task {
  id: string;                      // Unique identifier (e.g., "auth-impl", "fix-deps-1")
  name: string;                    // e.g., "Implement Authentication" or "Fix Missing Dependencies"
  type: 'setup' | 'feature' | 'error' | 'explain';  // setup = config (priority 100+), feature = from spec (200-899), error = from violations (900-999), explain = code explanation
  priority: number;                // Lower = more critical (setup: 100+, features: 200-899, errors: 900-999, final: 1000)
  description: string;             // What needs to be done
  errors?: string[];               // List of error messages (for error tasks)
  category?: ErrorCategory;        // Type of errors (for error tasks)
  completed?: boolean;             // Whether this task is done
  interrupted?: boolean;           // Whether this task was interrupted (stopped manually)
  timing?: TaskTiming;             // Task timing information
}

export class TaskQueue {
  private tasks: Task[] = [];
  
  push(task: Task): void {
    this.tasks.push(task);
    // Sort by priority (lower number = higher priority)
    // Error tasks (1-100) execute before feature tasks (200-299)
    this.tasks.sort((a, b) => a.priority - b.priority);
  }
  
  pop(): Task | undefined {
    return this.tasks.shift();
  }
  
  peek(): Task | undefined {
    return this.tasks[0];
  }
  
  isEmpty(): boolean {
    return this.tasks.length === 0;
  }
  
  size(): number {
    return this.tasks.length;
  }
  
  // Remove all tasks of specific type
  removeType(type: 'error' | 'feature'): void {
    this.tasks = this.tasks.filter(t => t.type !== type);
  }
  
  // Get all tasks (for debugging/logging)
  getAll(): Task[] {
    return [...this.tasks];
  }
}

// Alias for backward compatibility
export type Subtask = Task;
export type ErrorSubtask = Task;

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
  violations: Violation[];           // 발생한 에러들
  enforcementReason: string;         // 왜 enforcement가 발생했는지
  fixStrategy: 'retry' | 'add_tasks' | 'skip';  // 어떤 전략을 선택했는지
  addedTasks?: Task[];               // 추가된 에러 태스크 (add_tasks인 경우)
  timestamp: number;                 // 언제 발생했는지
}

export interface AttemptHistory {
  attemptNumber: number;           // Which attempt this was (1, 2, 3...)
  filesGenerated: string[];        // List of files created/modified
  keyChanges: string[];            // Human-readable summary of changes
  subtaskName?: string;            // Which subtask this was for (if any)
  errorsAttemptedToFix: string[];  // Which errors this attempt tried to fix
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];  // ✅ 구조화된 violation
}

/**
 * Code Task State (REFACTORED)
 * State for code generation graph (generate/refactor/explain)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Latest design document
 * - profile: Codebase profile (language/framework)
 */
export interface ArchitectGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext & { enableEvaluation?: boolean };
  spec: string;  // CLI input
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 NEW: DetectEnvironment Output
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  selectedDesignFiles?: string[];
  detectedEnvironment?: 'frontend' | 'backend' | 'fullstack' | 'unknown';
  environmentReasoning?: string;
  requireRagForDecompose?: boolean;
  decomposeKeywords?: {
    codebase: string[];
    references: Map<string, string[]>;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ✅ REFACTORED: Unified code context structure
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  projectCodeContext?: ProjectCodeContext;      // Main project code
  referenceCodeContexts: ReferenceCodeContext[]; // Reference projects
  
  // ✅ Design Documents (loaded in contextLoader)
  designDocs?: {
    apiContract?: string;
    feDesign?: string;
    beDesign?: string;
    unifiedDesign?: string;
  };
  
  // ✅ Reference Requests (registered in decompose, loaded per-task in plan)
  referenceRequests?: Array<{project: string; branch?: string}>;
  
  // Dependencies
  deps?: { 
    git?: GitPort; 
    memory?: MemoryPort; 
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    analyzer?: CodebaseAnalyzerPort;
    chunk?: ChunkPort;
    session?: SessionPort;
    command?: CommandPort;
    retriever?: import('../../../../core/codebase/CodebaseRetriever').CodebaseRetriever;  // ✅ NEW: For reference loading
    vectorDB?: MemoryPort;  // ✅ NEW: Explicit vectorDB port (same as memory)
    workspaceResolver?: import('../../../../infrastructure/workspace/WorkspaceResolver').WorkspaceResolver;  // ✅ For path resolution
    kanbanUpdate?: TaskQueueUpdatePort;  // ✅ For real-time Kanban updates
    fileTreeUpdate?: import('../../../../core/ports').FileTreeUpdatePort;  // ✅ For real-time file tree updates
    workflowUpdate?: import('../../../../core/ports').WorkflowStateUpdatePort;  // ✅ For real-time workflow visualization
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  
  // ✅ Mode (inferred by detectEnvironment LLM)
  mode?: 'generate' | 'refactor' | 'explain';  // Code mode inferred by detectEnvironment
  codeMode?: CodeMode;  // For backward compatibility (used in execute phase)
  
  // ✅ Session Context (compressed for LLM)
  sessionContext?: {
    recentTurns: Array<{
      turnId: number;
      directive: string;
      mode: string;
      output: string;
    }>;
    summary?: string;
    totalTurns: number;
    currentTurn: number;
    currentMode: string;
    windowSize: number;
    compressionRatio: number;
  };
  
  // ✅ Chat Integration
  overrideDirective?: string;  // Chat input as directive (highest priority)
  chatSource?: boolean;         // True if job started from chat (enables Chat SSE)
  
  // ✅ Replan Support (continue with new directive)
  directives?: string[];  // Multiple directives (newest first = highest priority)
  replanAction?: 'continue' | 'modify' | 'restart';  // LLM decision on how to handle new directive
  replanReason?: string;  // Explanation for replan decision
  tasksToModify?: string[];  // Task IDs to modify (if replanAction='modify')
  isReplanning?: boolean;  // Flag indicating we're in replan process

  // Execution
  planText: string;
  codePrompt: string;
  rawResponse: string;
  responseSection?: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];
  modifications?: any[];  // For evaluation
  featureName?: string;  // ✅ For buffer manager initialization
  
  // ✅ NEW: LLM Response (tool calling 지원)
  llmResponse?: {
    thinking?: string;           // LLM의 사고 과정 (UI 전용, conversation history에는 포함 안 함!)
    textResponse?: string;       // 일반 텍스트 응답
    toolCalls?: Array<{          // 도구 호출 목록
      id: string;
      name: string;
      args: Record<string, any>;
    }>;
    done: boolean;               // 작업 완료 여부
  };
  
  // ✅ NEW: Tool Results (도구 실행 결과)
  toolResults?: Array<{
    toolCallId: string;
    result: any;
    error?: string;
  }>;
  
  // ✅ NEW: File Buffers (state-level, 노드 로컬 아님!)
  fileBuffers?: Map<string, {
    path: string;
    content: string;
    actionType: 'create' | 'edit' | 'append' | 'delete';
    committed: boolean;          // 디스크 저장 완료 여부
    tempPath?: string;           // 임시 파일 경로
  }>;
  
  // ✅ NEW: Conversation History (멀티턴 대화)
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string | any[];     // Anthropic 형식 지원
  }>;

  requiredIntegrations: IntegrationRequirement[];
  violations?: Violation[];  // ✅ 구조화된 violation 배열

  retries: number;
  maxRetries: number;
  enforcementReason?: string | null;  // Validation errors passed from enforce to plan
  
  // Progress tracking (for smart retry reset)
  lastViolations?: Violation[];  // ✅ 구조화된 이전 violations
  previousFileCount?: number; // Previous file count to detect new files
  
  // Attempt history (to prevent repeating same mistakes)
  previousAttempts?: AttemptHistory[];  // History of what we tried before
  
  // Enforcement feedback history (학습 가능한 피드백)
  enforcementHistory?: EnforcementFeedback[];  // ✅ 모든 enforcement 이력
  
  // Task Queue System (Divide & Conquer)
  taskQueue?: TaskQueue;              // Priority queue of all tasks
  currentTask?: Task;                 // Currently executing task
  featureTasks?: Map<string, Task>;   // Original feature tasks (for tracking completion)
  completedTasks?: string[];          // Task IDs that finished successfully
  completedTasksDetails?: Task[];     // ✅ NEW: Full task objects of completed tasks (with timing, etc.)
  verifiedTasks?: Map<string, { passed: boolean; timestamp: string; errors?: string[] }>;  // ✅ Verification cache
  resolvedCategories?: ErrorCategory[]; // Categories with 0 errors (successfully resolved)
  
  // ✅ Failed Tasks (deferred to Final Verification)
  failedTasks?: Array<{
    taskId: string;
    taskName: string;
    taskType: 'setup' | 'feature';
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
  
  // Backward compatibility (deprecated)
  featureSubtasks?: Subtask[];        // @deprecated Use featureTasks
  currentSubtask?: Subtask;           // @deprecated Use currentTask
  remainingSubtasks?: Subtask[];      // @deprecated Use taskQueue
  completedSubtasks?: string[];       // @deprecated Use completedTasks
  subtaskIndex: number;               // Current subtask index (for display)
  totalSubtasks: number;              // Total number of subtasks
  
  // Runtime Validation
  runtimeValidationResult?: {
    passed: boolean;
    errors: string[];
  };
  
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
  
  // ✅ Real-time tracking and resume (internal, not persisted)
  _httpJobId?: string;  // Job ID for live updates and job resumption
  
  // ✅ Buffer Manager (for real-time MD file streaming with <file> tags)
  _bufferManager?: import('../../../../core/streaming/buffer/StreamBufferManager').StreamBufferManager;
  
  // ✅ Error repetition tracking (internal)
  _errorIsRepeating?: boolean;  // Flag to indicate if errors are repeating
  
  // ✅ Recursion tracking
  recursionCount?: number;  // Current iteration count
  recursionLimit?: number;  // Maximum allowed iterations
  
  // ✅ Interruption tracking
  interruption?: import('../../../../core/types').InterruptionDetails;  // Details about why and how the job was interrupted
}

/**
 * Task Timing Helper Functions
 */
export class TaskTimingHelper {
  /**
   * Start timing for a task
   */
  static startTask(task: Task): Task {
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
  static pauseTask(task: Task): Task {
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
  static completeTask(task: Task): Task {
    if (!task.timing?.startedAt) {
      console.warn('[TaskTiming] Cannot complete task without start time');
      return { ...task, completed: true };
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
      }
    };
  }
  
  /**
   * Get current elapsed time for a running task
   */
  static getCurrentElapsedTime(task: Task): number | null {
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
