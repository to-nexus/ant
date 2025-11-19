import { DesignMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { Task, TaskQueue } from "../code/state";  // ✅ Reuse Task and TaskQueue from code
import { StreamBufferManager } from '../../../../core/streaming/buffer/StreamBufferManager';  // ✅ NEW

// ✅ Re-export Task and TaskQueue for use in design nodes
export { Task, TaskQueue } from "../code/state";

/**
 * Design Task State
 * State for design generation graph (greenfield/evolution/refactor)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Previous design document
 * - code: Current codebase (for evolution/refactor)
 * - codeHead: Git HEAD version (not used in design)
 * - profile: Codebase profile (language/framework)
 */
export interface DesignGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext;
  spec: string;  // CLI input or PRD path
  
  // Dependencies
  deps?: {
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    chunk?: ChunkPort;
    session?: SessionPort;
    git?: GitPort;
    analyzer?: CodebaseAnalyzerPort;
    memory?: MemoryPort;
    kanbanUpdate?: TaskQueueUpdatePort;  // ✅ For real-time Kanban updates
    fileTreeUpdate?: import('../../../../core/ports').FileTreeUpdatePort;
    workflowUpdate?: import('../../../../core/ports/workflow').WorkflowStateUpdatePort;
  };

  // Mode (explicit or inferred)
  designMode?: DesignMode;  // greenfield / evolution / refactor
  
  // ✅ Chat Integration
  overrideDirective?: string;  // Chat input as directive (highest priority)
  chatSource?: boolean;         // True if job started from chat (enables Chat SSE)

  // ✅ NEW: Task Queue (for task breakdown like code)
  taskQueue?: TaskQueue;
  currentTask?: Task;
  completedTasks?: string[];  // Task IDs
  completedTasksDetails?: Task[];  // Full task details for resume

  // ✅ Job tracking (for timing and continuity)
  jobId?: string;  // Current active job ID (persists until completion or reset)
  jobTiming?: {
    startedAt: string;              // Job 최초 시작 시간 (Resume 후에도 유지)
    lastResumedAt?: string;         // 마지막 Resume 시간
    pausedAt?: string;              // 중단 시간 (Stop 또는 recursion limit)
    completedAt?: string;           // 완료 시간
    totalPausedDuration: number;    // 총 일시정지 시간 (ms)
    estimatingDuration?: number;    // Estimating 단계 소요 시간 (ms, decompose 완료까지)
    totalElapsedTime?: number;      // 총 실 소요 시간 (ms, 일시정지 제외)
  };

  // Execution
  planText: string;
  
  // ✅ UNIFIED: Files generated (same structure as code job)
  files?: Array<{ path: string; content: string }>;
  filesToDelete?: string[];
  
  // ✅ NEW: Tool Calling Support (same as code job)
  llmResponse?: {
    thinking?: string;
    textResponse?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, any>;
    }>;
    done: boolean;
  };
  
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string | any[];
  }>;
  
  // Results (populated by learn node)
  learnings?: string;
  
  // ✅ For tracking and resume
  _httpJobId?: string;  // Job ID for real-time UI updates and job resumption
  
  // ✅ NEW: Buffer Manager (for real-time file streaming with <file> tags)
  _bufferManager?: StreamBufferManager;
}
