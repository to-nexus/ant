import { DesignMode, CodebaseProfile, TaskArtifacts } from "../../../../core/types";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { DesignTask, TaskQueue } from "../../types/task";
import { TokenUsage } from '../common/llmHelpers';
import { JobTiming } from '../common/timing/JobTimingManager';

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
  workspaceConfig?: any;  // ✅ NEW: Workspace config for job/node-specific model selection
  
  // Dependencies
  deps?: {
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    chunk?: ChunkPort;
    session?: SessionPort;
    git?: GitPort;          // ✅ REFACTORED: Git operations only (no file I/O)
    fileSystem?: import('../../../../core/ports/filesystem').FileSystemPort;  // ✅ NEW: File I/O operations
    analyzer?: CodebaseAnalyzerPort;
    memory?: MemoryPort;
    workspaceResolver?: import('../../../../infrastructure/workspace/WorkspaceResolver').WorkspaceResolver;  // ✅ For path resolution (tenant-aware)
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
  taskQueue?: TaskQueue<DesignTask>;
  currentTask?: DesignTask;
  completedTasks?: string[];  // Task IDs
  completedTasksDetails?: DesignTask[];  // Full task details for resume

  // ✅ Job tracking (for timing and continuity)
  jobId?: string;
  jobTiming?: JobTiming;

  // Execution
  planText: string;
  
  // ✅ UNIFIED: Files generated (same structure as code job)
  files?: Array<{ 
    path: string; 
    content: string; 
    actionType?: 'create' | 'append' | 'edit' | 'delete';  // ✅ For design job XML streaming
  }>;
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
  
  // ✅ Token usage (per-turn and job-level)
  tokenUsage?: TokenUsage;
  jobTokenUsage?: TokenUsage;
  
  // Codebase context (for evolution/refactor modes)
  codeHead?: string;
  
  // Results (populated by learn node)
  lessons?: string;
  
  // ✅ For tracking and resume
  _httpJobId?: string;  // Job ID for real-time UI updates and job resumption

  // ✅ Design domain detection (game vs service)
  designDomain?: 'game' | 'service';
  designDomainReasoning?: string;
  
  // ✅ Design environment detection (frontend vs backend vs fullstack)
  designEnvironment?: 'frontend' | 'backend' | 'fullstack';
  designEnvironmentReasoning?: string;
  
  // ✅ UI specification existence flag
  // When true, system-design should defer UI implementation details to uiDoc
  hasUiDoc?: boolean;
  
  // ✅ NEW: Work type detection (ui-design vs system-design)
  // ui-design: Generate ui-tokens.md, ui-assets.md, ui-spec.md from Figma screenshots
  // system-design: Generate system-design.md or contract-first split docs
  designWorkType?: 'ui-design' | 'system-design';
  designWorkTypeReasoning?: string;
  
  // ✅ NEW: Error handling for invalid requests (e.g., modify without documents)
  designError?: {
    type: string;
    message: string;
    suggestedAction?: string;
  };
  
  // ✅ NEW: UI document generation context
  // Populated when designWorkType === 'ui-design'
  uiReferences?: {
    screens?: string[];      // inputs/references/screens/*
    components?: string[];   // inputs/references/components/*
  };
  uiAssetsList?: {
    logos?: string[];
    backgrounds?: string[];
    icons?: string[];
    other?: string[];
  };
}
