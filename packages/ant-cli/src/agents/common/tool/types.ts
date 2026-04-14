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
  commandComplete(command: string, success: boolean, exitCode: number, output: string, mergeIndex: number | undefined): Promise<void>;

  finalizeMessage(): Promise<void>;
  flush(): Promise<void>;
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

export interface VerificationTracker {
  typecheckRequired?: boolean;
  typecheckAttempted?: boolean;
  typecheckPassed?: boolean;
  buildAttempted?: boolean;
  buildPassed?: boolean;
  testAttempted?: boolean;
  testPassed?: boolean;
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
  verificationTracker?: VerificationTracker;
  depFileHash?: string;
  retries?: number;

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

export type ToolSideEffect =
  | { type: 'fileModified'; path: string }
  | { type: 'fileCreated'; path: string }
  | { type: 'fileDeleted'; path: string }
  | { type: 'commandExecuted'; exitCode: number; command: string; success: boolean; hasWarnings: boolean }
  | { type: 'depFileHashChanged'; newHash: string }
  | { type: 'serverStarted'; pid: number; command: string; workingDir: string }
  | { type: 'figmaError'; category: 'connection' | 'environment' | 'data' | 'rate_limit' | 'other' }
  | { type: 'figmaSuccess' }
  | { type: 'verificationInvalidated' };

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
