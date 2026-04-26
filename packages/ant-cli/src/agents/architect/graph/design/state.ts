import { CodebaseProfile } from "../../../../core/types";
import type { Conversations } from '../../../common/graph/conversations';
import { LLMClient, ChunkPort, SessionPort, GitPort, CodebaseAnalyzerPort, MemoryPort, TaskQueueUpdatePort, CommandPort } from "../../../../core/ports";
import type { PromptBuilder } from "../../../../core/prompt/builder/PromptBuilder";
import { ProjectContext } from "../../types";
import { DesignTask, TaskQueue } from "../../types/task";
import { TokenUsage } from '../../../common/graph/llmHelpers';
import { JobTiming } from '../../../common/graph/timing/JobTimingManager';
import { TriageableState } from '../../../common/graph/nodes/triage/types';
import type { Boundary, FigmaDataConfig, FigmaExplorationResult, ResolvedActionContext, ExecutionTierId } from '@ant/shared';
import type { FeatureContext } from "../../../../core/context/featureContextBuilder";

/**
 * Design Task State
 * State for design generation graph (generate/refactor/explain)
 *
 * All source/design data flows through `artifacts: ResolvedArtifact[]` pool.
 * The pool is built by resolve and consumed by all downstream nodes.
 */
export interface DesignGraphState extends TriageableState {
  // Context (narrowed from TriageableContext)
  context: ProjectContext;
  workspaceConfig?: any;  // Workspace config for job/node-specific model selection

  profile?: CodebaseProfile;
  
  // Dependencies (extends TriageableState.deps)
  deps?: {
    llm?: LLMClient;
    promptBuilder?: PromptBuilder;
    chunk?: ChunkPort;
    session?: SessionPort;
    git?: GitPort;
    fileSystem?: import('../../../../core/ports/filesystem').FileSystemPort;
    analyzer?: CodebaseAnalyzerPort;
    memory?: MemoryPort;
    workspaceResolver?: import('../../../../core/config/WorkspacePathResolver').WorkspaceResolver;
    kanbanUpdate?: TaskQueueUpdatePort;
    fileTreeUpdate?: import('../../../../core/ports').FileTreeUpdatePort;
    workflowUpdate?: import('../../../../core/ports/workflow').WorkflowStateUpdatePort;
    command?: CommandPort;
    redis?: any;
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unified artifact pool (resolve output, consumed by all downstream nodes)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  artifacts?: import('@ant/shared').ResolvedArtifact[];

  /**
   * Resume bridge channel — populated when a checkpoint persisted the
   * RAC-resolved artifact bundle. Resolve hydrates `artifacts` from this
   * (or via `loadResolvedArtifacts`) and clears it after merge.
   */
  resolvedArtifacts?: import('@ant/shared').ResolvedArtifact[];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RAC (detect output → decompose enriches basis.techTier: TechTierConfig)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  /**
   * Current user turn id (session redesign §2). Populated by design resolve
   * after reading feature.jsonl; consumed by learn for breadcrumb/boundary
   * attribution. The design sub-graph itself stays untouched (D5).
   */
  turnId?: string;

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
  
  // Unified conversations record
  conversations: Conversations;
  
  // ✅ Token usage (per-turn tracking; job-level is `tokenUsage` from ResolvableState)
  _currentTaskTokenUsage?: TokenUsage;
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
  // Populated when resolvedAction?.intentGroup === 'design-ui'
  uiAssetsList?: Record<string, string[]>;  // Dynamic keys by subdirectory under inputs/assets/
  
  // ✅ Figma Integration (All-or-Nothing: Full MCP required)
  figmaConfig?: FigmaDataConfig;        // Loaded from outputs/design/ui/figma/figma.json at resolve
  figmaExplorationResult?: FigmaExplorationResult;  // Output of figmaExplore node
  figmaAvailable?: boolean;              // MCP reachable — set by detect node
  figmaFileKey?: string;                 // Parsed from figmaConfig.file URL
  figmaStartNodeId?: string;             // Parsed nodeId from URL (optional)

  // ✅ Interruption & failure tracking (DEFECT-5: was only in channels, not interface)
  interruption?: import('../../../../core/types').InterruptionDetails;
  failedTasks?: Array<{
    taskId: string;
    taskName: string;
    timestamp: string;
    error?: string;
    taskType?: string;
    priority?: number;
    violations?: any[];
  }>;
  
  // ✅ Worker runtime injection
  workerId?: number;
  _isStopRequested?: (() => boolean);

  // Inter-Job Context Bridge
  boundary?: Boundary;

  /**
   * T2+T3 context loaded from feature.jsonl by resolve (session redesign).
   * Populated by `resolve_integrate` (§11) so design-level prompts can
   * consume prior breadcrumbs / user_turns without re-reading the file.
   * The design sub-graph (ui-design/system-design/spec) does not inject
   * this today — D5 keeps the sub-graph untouched — but the field is
   * declared so the state channel is discoverable and compatible with
   * future consumers without another state refactor.
   *
   * Shape SSOT lives in `core/context/featureContextBuilder.ts`
   * (`FeatureContext`). Do not redeclare inline here.
   *
   * §13 Compact policy: design resolve deliberately skips `compactFeatureContext`
   * (does not pass `llm`/`promptPort` to `hydrateFeatureContext`) because no
   * design prompt template renders `featureContext.summary`. Running Compact
   * here would fire an LLM call whose output nobody reads. If a future design
   * template starts consuming the summary, flip the hydrate call to pass
   * `llm`/`promptPort` and the Compact path activates automatically.
   */
  featureContext?: FeatureContext;

  /**
   * 5-tier execution strategy — LLM direct output from the Tier Entry Node
   * (Decompose). Phase nodes consume via `getExecutionTier(state)` only.
   */
  executionTier?: ExecutionTierId;
}
