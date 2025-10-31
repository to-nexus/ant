import { CodeMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { GitPort, MemoryPort, LLMClient, CodebaseAnalyzerPort, ChunkPort, SessionPort, CommandPort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";

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
 * Error tasks (10-99) always execute before feature tasks (200-299)
 */
export const TASK_PRIORITIES = {
  // Error Tasks (10-99) - lower number = more critical
  ERROR_MISSING_ENTRY: 10,      // index.html 같은 entry 파일 (가장 중요)
  ERROR_MISSING_DEPS: 15,       // package 의존성
  ERROR_CONFIG: 20,             // tsconfig.json 등
  ERROR_TYPE: 30,               // TypeScript 타입 에러
  ERROR_IMPORT: 35,             // Import 에러
  ERROR_BUILD: 40,              // 빌드 에러
  ERROR_SYNTAX: 50,             // 문법 에러
  ERROR_LINT: 70,               // Lint 에러
  ERROR_OTHER: 80,              // 기타
  
  // Feature Tasks (200-299) - execute after all errors resolved
  FEATURE_CRITICAL: 200,        // 가장 중요한 기능
  FEATURE_IMPORTANT: 220,
  FEATURE_NORMAL: 250,
  FEATURE_NICE_TO_HAVE: 280,    // 가장 덜 중요한 기능
} as const;

export interface Task {
  id: string;                 // Unique identifier (e.g., "auth-impl", "fix-deps-1")
  name: string;               // e.g., "Implement Authentication" or "Fix Missing Dependencies"
  type: 'feature' | 'error';  // feature = from spec (persistent), error = from violations (temporary)
  priority: number;           // Lower = more critical (errors: 1-100 execute first, features: 200-299 execute after)
  description: string;        // What needs to be done
  errors?: string[];          // List of error messages (for error tasks)
  category?: ErrorCategory;   // Type of errors (for error tasks)
  completed?: boolean;        // Whether this task is done
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
 * Code Task State
 * State for code generation graph (generate/refactor/explain)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Latest design document
 * - code: Current codebase (working tree)
 * - codeHead: Git HEAD version (for comparison)
 * - profile: Codebase profile (language/framework)
 */
export interface ArchitectGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext & { enableEvaluation?: boolean };
  spec: string;  // CLI input
  
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
  };
  gitPort?: GitPort;  // For runner to use after graph execution
  
  // Mode (inferred or explicit)
  codeMode?: CodeMode;  // generate / refactor / explain

  // Execution
  planText: string;
  codePrompt: string;
  rawResponse: string;
  responseSection?: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];
  modifications?: any[];  // For evaluation

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
  resolvedCategories?: ErrorCategory[]; // Categories with 0 errors (successfully resolved)
  
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
  
  // Learning
  learnings?: string;
  
  // Results (populated by learn node)
  branch?: string;
  filesWritten?: number;
  reportFile?: string;
}
