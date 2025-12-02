/**
 * Chat Message Types
 * 
 * Types for AI agent chat interface (Cursor-style)
 */

export type MessageRole = 'user' | 'assistant';

export type MessageContentType = 
  // 🎯 Chat Status Messages (progress indicators only)
  | 'placeholder'    // "Planning next moves..." (system-generated, shown at node start)
  | 'exploring'      // Scanning codebase (in progress)
  | 'explored'       // Codebase scan complete
  | 'grepping'       // Searching codebase (in progress)
  | 'grepped'        // Search complete
  | 'reading'        // Reading file (in progress)
  | 'read'           // File read complete
  | 'indexing'       // Codebase indexing (in progress)
  | 'indexed'        // Codebase indexing complete
  | 'analyzing'      // Analysis in progress
  | 'analyzed'       // Analysis complete
  // General content (Chat Status Messages HIDE when these arrive)
  | 'thinking'       // LLM's thought process (collapsible block, accumulates, multiple blocks possible)
  | 'text'           // General text response
  | 'cancelled'      // Task cancelled by user (with Resume button)
  // File Operations - Real-time streaming
  | 'file_creating'  // File creation started (header only)
  | 'file_writing'   // File being written (real-time code streaming)
  | 'file_create'    // File creation complete (collapsible)
  | 'file_editing'   // File edit started (header only)
  | 'file_updating'  // File being updated (real-time diff streaming)
  | 'file_edit'      // File edit complete (collapsible)
  | 'file_deleting'  // File deletion started
  | 'file_delete'    // File deletion complete
  // Tool Actions - Cursor/Copilot style (minimal, one-line display)
  | 'tool_action'    // Simple tool actions (mkdir, etc.) - ✓ Created organisms/, templates/
  // Command Execution - Real-time streaming
  | 'command_running'   // Command started (header only)
  | 'command_streaming' // Command output streaming
  | 'command';          // Command complete (collapsible)

export interface MessageContent {
  type: MessageContentType;
  content: string;
  metadata?: {
    filePath?: string;      // For file operations & read
    diffBefore?: string;    // For file edit (before state)
    diffAfter?: string;     // For file edit (after state)
    command?: string;       // For command execution
    exitCode?: number;      // For command result
    timestamp?: string;
    jobId?: string;         // For cancelled: job ID to resume
    reason?: string;        // For cancelled/interrupted: interruption reason (also used for file operations)
    // Exploration & Analysis
    filesCount?: number;    // For explored/grepped
    totalFiles?: number;    // For exploring/grepping progress
    tokensCount?: number;   // For explored
    strategy?: string;      // For grepped (git/vector/keyword)
    filesList?: string[];   // List of files (for explored/grepped)
    // Indexing (for indexing/indexed)
    filesIndexed?: number;  // Number of files indexed
    chunks?: number;        // Number of chunks created
    tokens?: number;        // Estimated tokens
    duration?: number;      // Indexing duration (ms)
    repoName?: string;      // Repository name
    branch?: string;        // Branch name
    commit?: string;        // Commit hash
    message?: string;       // Status message
    // Tool Actions
    toolName?: string;      // For tool_action: tool name (mkdir, etc.)
    actionIcon?: string;    // For tool_action: emoji/icon to display
    // Metadata
    provider?: string;      // 'system' or 'llm'
    model?: string;         // LLM model name
    blockStart?: boolean;   // For thinking: marks <thinking> tag opened (new block)
    durationMs?: number;    // For thinking: duration in milliseconds
    collapsed?: boolean;    // For thinking: marks if the block should be collapsed
  };
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  contents: MessageContent[];  // A message can have multiple content blocks
  timestamp: string;
  isStreaming?: boolean;  // Currently being streamed
}

export interface ChatSession {
  id: string;
  projectId: string;
  featureName: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * File Statistics - Count of file operations in current conversation
 */
export interface FileStats {
  filesEdited: number;
  filesCreated: number;
  filesDeleted: number;
  totalFiles?: number;
  // ✅ File list details (for collapsible view)
  files?: Array<{
    path: string;
    operation: 'create' | 'edit' | 'delete';
  }>;
}

