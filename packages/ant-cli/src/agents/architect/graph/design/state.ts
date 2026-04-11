import { CodebaseProfile, TaskArtifacts, DetectionReport } from "../../../../core/types";
import type { ConversationEntry } from "../../../../core/types/session";
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { ProjectContext } from "../../types";
import { DesignTask, TaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { JobTiming } from '../../../common/graph/timing/JobTimingManager';
import { TriageableState } from '../../../common/nodes/triage/types';
import type { FigmaDataConfig, FigmaExplorationResult, ResolvedActionContext } from '@ant/shared';

/**
 * Design Task State
 * State for design generation graph (generate/refactor/explain)
 * 
 * Inherits TaskArtifacts which provides:
 * - prd: PRD document
 * - directive: User instruction
 * - design: Previous design document (single string for docGen)
 */
export interface DesignGraphState extends TaskArtifacts, TriageableState {
  // Context (narrowed from TriageableContext)
  context: ProjectContext;
  workspaceConfig?: any;  // Workspace config for job/node-specific model selection
  
  // Dependencies (extends TriageableState.deps)
  deps?: {
    llm?: LLMClient;
    promptEngine?: PromptEngine;
    chunk?: ChunkPort;
    session?: SessionPort;
    git?: GitPort;
    fileSystem?: import('../../../../core/ports/filesystem').FileSystemPort;
    analyzer?: CodebaseAnalyzerPort;
    memory?: MemoryPort;
    workspaceResolver?: import('../../../../infrastructure/workspace/WorkspaceResolver').WorkspaceResolver;
    kanbanUpdate?: TaskQueueUpdatePort;
    fileTreeUpdate?: import('../../../../core/ports').FileTreeUpdatePort;
    workflowUpdate?: import('../../../../core/ports/workflow').WorkflowStateUpdatePort;
    redis?: any;
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 DetectionReport (통합 환경 감지 결과)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  detectionReport?: DetectionReport;
  resolvedAction?: ResolvedActionContext;

  // ✅ NEW: Task Queue (for task breakdown like code)
  taskQueue?: TaskQueue<DesignTask>;
  /** Set by design graph (parallel mode) for MECE sibling-task context in docGen */
  _allTasksSummary?: Array<{
    id: string;
    name: string;
    description?: string;
    targetFile?: string;
  }>;
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
    thinkingSignature?: string;
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
    content: string | import('../../../../core/ports/llm').MessageContentBlock[];
  }>;
  
  // ✅ Token usage (per-turn and job-level)
  _currentTaskTokenUsage?: TokenUsage;
  jobTokenUsage?: TokenUsage;
  _estimatingTokenUsage?: TokenUsage;
  
  
  
  /** File operation errors from StreamOrchestrator (incomplete tags, write failures) */
  fileErrors?: string[];

  /** Per-task docGen call counter (reset on task transition) */
  _docGenCallIndex?: number;
  
  /** Set by docGenRouter when call budget exhausted — signals checkTaskStatus to create interruption */
  _callLimitReached?: boolean;
  
  /** Counter for consecutive docGen calls with no file output (non-productive loop detection) */
  _noOutputCallCount?: number;

  /** Cached read-only tool results to avoid redundant calls (key: "toolName:argsJSON") */
  _toolResultCache?: Record<string, string>;

  /** Set by checkTaskStatus when ui-assets src validation fails — signals router to retry via docGen */
  _assetValidationFailed?: boolean;

  /** Retry counter for asset validation (max 2 retries before forced completion) */
  _assetValidationRetried?: number;

  /** Consecutive Figma MCP failure counter (reset on success, persists across tool→docGen loop) */
  _figmaConsecutiveErrors?: number;

  /** Set by tool node when Figma MCP fails N consecutive times — signals docGenRouter to stop */
  _figmaConnectionLost?: boolean;

  // Results (populated by learn node)
  lessons?: string;
  
  // ✅ Recursion tracking (for UI gauge display)
  recursionCount?: number;
  recursionLimit?: number;
  
  // ✅ UI locale (narrowed from TriageableState.string to literal union)
  _uiLocale?: 'ko' | 'en';
  
  
  
  // ✅ Spec clarify: paused waiting for user clarification (session-persisted, used by resume routing)
  awaitingClarify?: boolean;

  // ✅ Detect clarify: paused waiting for user to choose between spec and system-design
  awaitingDetectClarify?: boolean;

  // ✅ Structured existing design documents (loaded at resolve, used by decompose)
  // Key = filename (e.g. "api-contract-main.md", "ui-tokens.json"), Value = content
  // Unified map eliminates fragmented feDesign/feDesigns/beDesign/beDesigns distinction
  // NOT stored in session — always reloaded from disk (including on resume)
  existingDesignDocs?: Record<string, string>;
  
  // ✅ Error handling for invalid requests (e.g., modify without documents)
  designError?: {
    type: string;
    message: string;
  };
  
  // ✅ UI document generation context
  // Populated when detectionReport.detectedIntentGroup === 'design-ui'
  uiReferences?: string[];  // All image paths under inputs/references/ (recursive)
  uiAssetsList?: Record<string, string[]>;  // Dynamic keys by subdirectory under inputs/assets/
  
  // ✅ Figma Integration (All-or-Nothing: Full MCP required)
  figmaConfig?: FigmaDataConfig;        // Loaded from inputs/figma.json at resolve
  figmaExplorationResult?: FigmaExplorationResult;  // Output of figmaExplore node
  figmaAvailable?: boolean;              // MCP reachable — set by detectEnvironment (spec: tools only, ui-design: full pipeline)
  figmaFileKey?: string;                 // Parsed from figmaConfig.file URL
  figmaStartNodeId?: string;             // Parsed nodeId from URL (optional)

  // ✅ Interruption & failure tracking (DEFECT-5: was only in channels, not interface)
  interruption?: import('../../../../core/types').InterruptionDetails;
  failedTasks?: Array<{
    taskId: string;
    taskName: string;
    taskType: string;
    priority: number;
    violations?: any[];
    timestamp: string;
  }>;
  
  // ✅ Worker runtime injection
  workerId?: number;
  _isStopRequested?: (() => boolean);

  // Inter-Job Context Bridge
  boundary?: 'heavyweight' | 'lightweight';
  jobConversation?: ConversationEntry[];
}
