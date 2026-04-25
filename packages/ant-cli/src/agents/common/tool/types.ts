/**
 * Unified Tool System Types
 *
 * Shared type definitions for the 2-layer tool architecture:
 *   Layer 1: ToolOrchestrator (batch execution, caching, workflow, chatStatus)
 *   Layer 2: ToolHandler (context-injected, per-tool logic)
 *
 * Handlers receive ToolExecutionContext instead of raw graph state.
 * State mutations are communicated back via ToolSideEffect discriminated unions.
 */

import type { FileSystemPort } from '../../../core/ports/filesystem';
// Gate vocabulary SSOT — declared once in
// `tasks/_shared/verify/gates.ts` and imported here so the side-effect
// channel and the `VerificationSessionSurface` cannot drift from the
// Session's required/passed sets. The path crosses the common→code-graph
// boundary, but `Gate` is a 3-element string union with no structural
// dependencies, so the import stays inert.
import type { Gate } from '../../architect/graph/code/tasks/_shared/verify/gates';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ChatStatusReporter — UI coupling isolation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ChatStatusReporter {
  /**
   * Emit a chat status card. Returns the `cardId` (string) of the
   * resulting card so progress→terminal pairs can chain via
   * `metadata._mergeIndex` (legacy field name; the value is now the
   * cardId, not a contents-array index).
   *
   * Pre-§5 signature returned `number | undefined` (an in-message
   * contents index). The chat-SSOT rewrite replaces that index with a
   * stable cardId so cross-pod / replay flows can address the same
   * card without rebuilding the in-memory `ChatMessage` scratchpad.
   */
  showStatus(key: string, data?: Record<string, any>): Promise<string | undefined>;
  removeStatus(cardId: string, key: string): Promise<void>;

  addReadingFile(path: string): Promise<string | undefined>;
  addReadComplete(path: string, cardId: string | undefined, error?: string): Promise<void>;

  addReadingSource(filename: string, startLine?: number, endLine?: number): Promise<string | undefined>;
  addReadSourceComplete(filename: string, cardId: string | undefined, opts?: {
    error?: string;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
  }): Promise<void>;

  startFileEdit(path: string): void;
  completeFileEdit(path: string, oldStr: string, newStr: string): Promise<void>;
  failFileEdit(path: string, error: string): Promise<void>;
  completeFileDeletion(path: string): Promise<void>;
  completeFileCreation(path: string, content: string, stats?: { diffBeforeLines?: number }): Promise<void>;
  failFileCreation(path: string, error: string): Promise<void>;

  commandStart(command: string): Promise<string | undefined>;
  /**
   * Push an incremental (accumulated) output snapshot to the chat UI.
   * Callers should throttle / coalesce upstream so this runs at most a
   * few times per second per command. The implementation forwards to
   * `LLMResponseService.streamCommandOutput`, which computes a delta
   * before broadcasting to keep Redis pub/sub payloads small.
   */
  streamCommandOutput(command: string, output: string): Promise<void>;
  /**
   * Mark the running command complete and capture its terminal output.
   *
   * `success` is retained for historical call-site ergonomics but carries
   * no information the other fields do not already encode; implementations
   * ignore it. The `mergeIndex` that prior versions used to target a
   * specific content slot was never consumed by the backend and is
   * removed.
   */
  commandComplete(
    command: string,
    success: boolean,
    exitCode: number,
    output: string,
  ): Promise<void>;

  finalizeMessage(): Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolExecutionContext — job-specific extension via optionals
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CommandPort {
  execute(command: string, opts: {
    cwd: string;
    timeout: number;
    env?: Record<string, string>;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
    onExit?: (code: number) => void;
  }): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }>;
  isAllowed(command: string): boolean;
}

export interface GitPort {
  [key: string]: any;
}

export interface FileTreeUpdatePort {
  notifyFileTreeUpdate(project: string, featureName: string): Promise<void>;
}

/**
 * Minimal surface of `VerificationSession` that the tool / command-policy
 * handlers consume. Declared here (rather than imported from
 * `tasks/_shared/verify/Session`) so the common tool layer stays free
 * of code-graph imports.
 *
 * The full class lives at
 * `agents/architect/graph/code/tasks/_shared/verify/Session.ts`.
 */
export interface VerificationSessionSurface {
  required(): Gate[];
  missing(): Gate[];
  passed(): Gate[];
  isComplete(): boolean;
  dependencyStatus(): 'current' | 'changed' | 'unknown';
  inDeepMode(): boolean;
}

export interface ToolExecutionContext {
  // === Common (all jobs) ===
  fileSystem: FileSystemPort;
  chatStatus: ChatStatusReporter;

  workingDir: string;
  featurePath?: string;
  project?: string;
  featureFolder?: string;

  /**
   * Record a file-mutation event to the active task's per-task SSOT
   * (`CodeTask.touchedFiles`). Called at the same spot where
   * `chatStatus.completeFile*` emits the UI event — chat.jsonl is
   * ephemeral, this path is the authoritative session record that
   * persists into `code.json` via `completedTasksDetails`.
   *
   * Optional because design/non-task contexts may omit it; handlers
   * must use optional-chaining (`ctx.recordFileTouch?.(...)`).
   */
  recordFileTouch?: (op: 'create' | 'update' | 'delete', path: string) => void;

  // === Optional ports (per job) ===
  command?: CommandPort;
  git?: GitPort;
  redis?: any;
  fileTreeUpdate?: FileTreeUpdatePort;

  // === Figma fetch handlers ===
  figmaConfig?: any;
  figmaFileKey?: string;
  figmaExplorationResult?: any;
  figmaAvailable?: boolean;

  // === Command policy / verification handlers ===
  activePhase?: 'plan' | 'execute';
  currentTaskType?: string;
  /**
   * True when the active task was spawned from a parent's batch-split
   * (i.e. `CodeTask.prePlanText` was populated before the worker picked
   * it up). Sub-tasks carry a pre-planned slice / fix list and MUST NOT
   * mutate shared state that the parent already owned — specifically,
   * test-code sub-tasks must not install dependencies (their parent did)
   * or edit shared manifest / config files. Task-type command guards read
   * this flag to differentiate parent vs sub behaviour without pulling
   * `currentTask` wholesale into the common tool layer.
   */
  currentTaskHasPrePlanText?: boolean;
  /**
   * Read-only handle onto the active task's `VerificationSession` (when
   * the current task is verification-typed). Command-policy hooks consult
   * the session for gate state and dependency observation status instead
   * of the flattened `verificationTracker` / `depFileHash` fields that
   * existed pre-T4b-β. Dependency install status itself is a codebase
   * observation (see `invalidationScope.areDepsInstalled`), not a
   * hash cached on the session (F3).
   */
  verificationSession?: VerificationSessionSurface;
  retries?: number;
  /** Deep-diagnostic mode active: loosen loop guards so the LLM can
   *  probe config / dependency variants and re-run verification commands with
   *  different options once per attempt. */
  isDeepDiagnostic?: boolean;

  /** Phase 3-15 — number of `search_web` calls already executed in the current
   *  plan-toolLoop session. Handlers reject further calls once this reaches
   *  the configured limit to prevent runaway web-search expansion. */
  planSearchWebCount?: number;
  /** Configured limit (default 3, env `ANT_PLAN_SEARCH_WEB_MAX`). */
  planSearchWebLimit?: number;

  // === Reference search handlers ===
  referenceRequests?: any[];
  resolvedActionMode?: string;
  retriever?: any;
  vectorDB?: any;
  workspaceResolver?: any;
  userId?: string;
  organizationId?: string;

  // === Artifact read handlers ===
  sourceDocuments?: any;
  files?: Map<string, any>;

  // === Design-specific (populated by design buildContext) ===
  uiReferences?: string[];
  uiAssetsList?: Record<string, string[]>;
  existingDesignDocs?: Record<string, string>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolResult + ToolSideEffect — handler return types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Scope of verification invalidation triggered by a file change.
 * Scope hint (see handlers/invalidationScope.ts) — lets the tracker retain
 * already-passed steps when the edited file
 * cannot logically affect them (e.g. changing a test file should not reset
 * typecheck/build status).
 */
export type InvalidationScope = 'typecheck' | 'build' | 'test' | 'all';

export type ToolSideEffect =
  | { type: 'fileModified'; path: string }
  | { type: 'fileCreated'; path: string }
  | { type: 'fileDeleted'; path: string }
  | { type: 'fileNotChanged'; path: string }
  | { type: 'commandExecuted'; exitCode: number; command: string; success: boolean; hasWarnings: boolean; verifies?: Gate }
  | { type: 'serverStarted'; pid: number; command: string; workingDir: string }
  | { type: 'figmaError'; category: 'connection' | 'environment' | 'data' | 'rate_limit' | 'other' }
  | { type: 'figmaSuccess' }
  | {
      type: 'verificationInvalidated';
      scope: InvalidationScope;
      reason: string;
    };

export interface ToolResult {
  content: string | any[];
  error?: string;
  sideEffects?: ToolSideEffect[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolHandler — unified handler signature
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ToolHandler = (
  ctx: ToolExecutionContext,
  args: Record<string, any>,
) => Promise<ToolResult>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolCall — from LLM response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Batch execution types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ToolExecutionEvent {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  result: ToolResult;
  cached: boolean;
}

export interface BatchExecutionResult {
  events: ToolExecutionEvent[];
  toolUseBlocks: any[];
  toolResultBlocks: any[];
  updatedCache?: Record<string, string>;
}
