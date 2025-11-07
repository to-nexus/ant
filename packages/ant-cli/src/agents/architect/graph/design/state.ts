import { DesignMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { Task, TaskQueue } from "../code/state";  // ✅ Reuse Task and TaskQueue from code

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

  // ✅ NEW: Task Queue (for task breakdown like code)
  taskQueue?: TaskQueue;
  currentTask?: Task;
  completedTasks?: string[];  // Task IDs
  completedTasksDetails?: Task[];  // Full task details for resume

  // Execution
  planText: string;
  designMarkdown: string;
  
  // Results (populated by learn node)
  designFilePath?: string;
  learnings?: string;
  
  // ✅ For tracking in UI
  _httpTaskId?: string;
}
