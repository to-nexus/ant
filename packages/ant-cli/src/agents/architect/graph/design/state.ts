import { CodebaseProfile, TaskArtifacts, DetectionReport } from "../../../../core/types";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { DesignTask, TaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { JobTiming } from '../../../common/graph/timing/JobTimingManager';
import { TriageResult, WorkspaceState } from '../../../common/nodes/triage/types';

/**
 * Design Task State
 * State for design generation graph (generate/refactor/explain)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Previous design document (single string for docGen)
 */
export interface DesignGraphState extends TaskArtifacts {
  // Context
  context: ProjectContext;
  workspaceConfig?: any;  // Workspace config for job/node-specific model selection
  
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
  
  

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 DetectionReport (통합 환경 감지 결과)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /** 통합 환경 감지 결과 (jobMode, workType, environment, domain 등 포함) */
  detectionReport?: DetectionReport;
  
  // ✅ Resume flag (API level, set by runner before graph invoke)
  isResume?: boolean;
  
  // ✅ Chat Integration
  overrideDirective?: string;  // Chat input as directive (highest priority)
  chatSource?: boolean;         // True if job started from chat (enables Chat SSE)

  // ✅ Triage System
  skipTriage?: boolean;          // Skip triage if true
  triageResult?: TriageResult;   // Triage analysis result
  workspaceState?: WorkspaceState;  // Workspace state snapshot
  currentAgent?: string;         // Current agent name (e.g., 'architect')
  currentJob?: string;           // Current job name (e.g., 'design')

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
  _estimatingTokenUsage?: TokenUsage;
  
  
  
  // Results (populated by learn node)
  lessons?: string;
  
  // ✅ Recursion tracking (for UI gauge display)
  recursionCount?: number;
  recursionLimit?: number;
  
  // ✅ For tracking and resume
  _httpJobId?: string;  // Job ID for real-time UI updates and job resumption
  _phaseTimings?: Record<string, number>;  // Per-node ms timings for phaseBreakdown
  _uiLocale?: 'ko' | 'en';  // UI locale detected from directive
  
  
  
  // ✅ Structured existing design documents (loaded at resolve, used by decompose)
  // Key = filename (e.g. "api-contract.md", "ui-tokens.json"), Value = content
  // Unified map eliminates fragmented feDesign/feDesigns/beDesign/beDesigns distinction
  // NOT stored in session — always reloaded from disk (including on resume)
  existingDesignDocs?: Record<string, string>;
  
  // ✅ Error handling for invalid requests (e.g., modify without documents)
  designError?: {
    type: string;
    message: string;
    suggestedAction?: string;
  };
  
  // ✅ UI document generation context
  // Populated when detectionReport.workType === 'ui-design'
  uiReferences?: string[];  // All image paths under inputs/references/ (recursive)
  uiAssetsList?: Record<string, string[]>;  // Dynamic keys by subdirectory under inputs/assets/
}
