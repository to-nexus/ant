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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ChatStatusReporter — UI coupling isolation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ChatStatusReporter {
  showStatus(key: string, data?: Record<string, any>): Promise<number | undefined>;
  removeStatus(index: number, key: string): Promise<void>;

  addReadingFile(path: string): Promise<number | undefined>;
  addReadComplete(path: string, mergeIndex: number | undefined, error?: string): Promise<void>;

  addReadingSource(filename: string, startLine?: number, endLine?: number): Promise<number | undefined>;
  addReadSourceComplete(filename: string, mergeIndex: number | undefined, opts?: {
    error?: string;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
  }): Promise<void>;

  startFileEdit(path: string): void;
  completeFileEdit(path: string, oldStr: string, newStr: string): Promise<void>;
  failFileEdit(path: string, error: string): Promise<void>;
  completeFileDeletion(path: string): Promise<void>;
  completeFileCreation(path: string, content: string): Promise<void>;
  failFileCreation(path: string, error: string): Promise<void>;

  commandStart(command: string): Promise<number | undefined>;
  /**
   * Push an incremental (accumulated) output snapshot to the chat UI.
   * Callers should throttle / coalesce upstream so this runs at most a
   * few times per second per command. The implementation forwards to
   * `LLMResponseService.streamCommandOutput`, which computes a delta
   * before broadcasting to keep Redis pub/sub payloads small.
   */
  streamCommandOutput(command: string, output: string): Promise<void>;
  commandComplete(command: string, success: boolean, exitCode: number, output: string, mergeIndex: number | undefined): Promise<void>;

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
 * `tasks/verification/model/Session`) so the common tool layer stays free
 * of code-graph imports.
 *
 * The full class lives at
 * `agents/architect/graph/code/tasks/verification/model/Session.ts`.
 */
export interface VerificationSessionSurface {
  required(): Array<'typecheck' | 'build' | 'test'>;
  missing(): Array<'typecheck' | 'build' | 'test'>;
  passed(): Array<'typecheck' | 'build' | 'test'>;
  attemptedThisCycle(): Array<'typecheck' | 'build' | 'test'>;
  isComplete(): boolean;
  dependencyStatus(): 'current' | 'changed' | 'unknown';
  inDeepMode(): boolean;
  /** Preemptive attempt marker used by the command-policy guard. */
  markAttempted(gate: 'typecheck' | 'build' | 'test'): void;
}

export interface ToolExecutionContext {
  // === Common (all jobs) ===
  fileSystem: FileSystemPort;
  chatStatus: ChatStatusReporter;

  workingDir: string;
  featurePath?: string;
  project?: string;
  featureFolder?: string;

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
  | { type: 'commandExecuted'; exitCode: number; command: string; success: boolean; hasWarnings: boolean }
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
