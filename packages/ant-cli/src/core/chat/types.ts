/**
 * Chat Types - Shared type definitions for chat functionality
 * 
 * Used by both LLMResponseService (job) and ChatService (api)
 */

import type { UserContext } from '../types/user';

/**
 * Message content types - unified chat status and content types
 */
export interface MessageContent {
  type: // Chat Status Messages (progress indicators)
     | 'placeholder'
     | 'thinking'       // LLM thinking / reasoning
     | 'exploring' | 'explored'   // Codebase scan (git changes)
     | 'retrieving' | 'retrieved' // Vector DB search
     | 'grepping' | 'grepped'     // Local file search (fallback)
     | 'reading' | 'read'         // File read
     | 'indexing' | 'indexed'     // Codebase indexing (learn job)
     | 'analyzing' | 'analyzed'   // File analysis (learn job)
     | 'storing' | 'stored'       // Lesson storage (learn job)
     | 'learning' | 'learned'     // Codebase learning (code job - post task)
     // General content
     | 'text'
     | 'cancelled'      // Task cancelled (with Resume button)
     | 'triage_choice'  // Triage redirect/blocked choice
     // File Operations - Real-time streaming
     | 'file_creating' | 'file_writing' | 'file_create' | 'file_create_failed'
     | 'file_editing' | 'file_updating' | 'file_edit' | 'file_edit_failed'
     | 'file_deleting' | 'file_delete' | 'file_delete_failed'
     // Tool Actions - Cursor/Copilot style
     | 'tool_action'    // Simple tool actions (mkdir, etc.)
     // Tool Results - list_files, search_code
     | 'listing_files' | 'listed_files'
     | 'searching_code' | 'searched_code'
     | 'searching_reference' | 'searched_reference'
     // Command Execution - Real-time streaming
     | 'command_running' | 'command_streaming' | 'command';
  content: string;
  metadata?: MessageContentMetadata;
}

/**
 * Message content metadata
 */
export interface MessageContentMetadata {
  filePath?: string;
  diffBefore?: string;    // For file edit (before state)
  diffAfter?: string;     // For file edit (after state)
  command?: string;
  exitCode?: number;
  timestamp?: string;
  // Exploration & Analysis
  filesCount?: number;    // For explored/grepped
  totalFiles?: number;    // For exploring/grepping progress
  tokensCount?: number;   // For explored
  strategy?: string;      // For grepped (git/vector/keyword)
  filesList?: string[];   // List of files (for explored/grepped)
  // Tool Actions
  toolName?: string;      // For tool_action: tool name
  actionIcon?: string;    // For tool_action: emoji/icon
  // LLM metadata
  model?: string;         // LLM model used
  provider?: string;      // LLM provider (e.g., 'anthropic', 'openai')
  blockStart?: boolean;   // For thinking: marks <thinking> tag opened (new block)
  blockEnd?: boolean;     // For thinking: marks </thinking> tag closed (block end)
  // Cancelled metadata
  jobId?: string;         // For cancelled/triage_choice: job ID
  reason?: string;        // For cancelled/file operations: cancellation/failure reason
  originalType?: string;  // For cancelled: original work type that was cancelled
  // Triage choice metadata
  choiceOptions?: {       // For triage_choice: choice options
    positive: { label: string; action: string };
    negative: { label: string; action: string };
    fallbackGuide?: string;
  };
  choiceSelected?: string;  // For triage_choice: selected action
  resolvedLabel?: string;   // For triage_choice: resolved label
  durationMs?: number;    // For thinking: duration in milliseconds
  collapsed?: boolean;    // For thinking: marks if the block should be collapsed
  // Indexing metadata (for indexing/indexed types)
  message?: string;       // For indexing: display message
  repoName?: string;      // For indexing/indexed: repository name
  branch?: string;        // For indexing/indexed: branch name
  commit?: string;        // For indexing/indexed: commit hash
  filesIndexed?: number;  // For indexed: number of files indexed
  chunks?: number;        // For indexed: number of chunks created
  tokens?: number;        // For indexed: estimated tokens
  duration?: number;      // For indexed: duration in milliseconds
  error?: string;         // For indexed: error message if failed
  // Tool-specific metadata
  query?: string;         // For retrieving/grepping
  keywords?: string[];    // For grepping
  directory?: string;     // For listing_files
  pattern?: string;       // For searching_code, listing_files
  totalMatches?: number;  // For searched_code
  project?: string;       // For searching_reference
  // Learn metadata
  taskName?: string;      // For learning
  filesWritten?: number;  // For learned
  // Merge control
  _mergeIndex?: number;   // Explicit merge target index
}

/**
 * Chat message structure
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  contents: MessageContent[];
  timestamp: string;
  jobId?: string; // Which job this message belongs to
  isStreaming?: boolean;
}

/**
 * Chat session file format (for persistence)
 */
export interface ChatSessionFile {
  projectId: string;
  featureName: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/**
 * File operation tracking
 */
export interface FileOperationTracker {
  filePath: string;
  contentIndex: number;
}

/**
 * In-memory chat session
 */
export interface ChatSession {
  projectId: string;
  featureName: string;
  jobId?: string;
  messages: ChatMessage[];
  currentMessage?: ChatMessage; // Message being streamed
  activeFileOperations?: Map<string, FileOperationTracker>;  // Track multiple files
  thinkingStartTime?: number;  // Track thinking block start time (ms)
  lastThinkingContentIndex?: number;  // Track last thinking content index
  userContext?: UserContext;  // Store user context for file operations
}

/**
 * File operation phases
 */
export type FileOperationPhase = 'creating' | 'writing' | 'editing' | 'updating' | 'deleting' | 'complete' | 'failed';

/**
 * Command execution phases
 */
export type CommandExecutionPhase = 'running' | 'streaming' | 'complete';

/**
 * Chat status types (progress indicators)
 */
export const CHAT_STATUS_TYPES = new Set([
  'placeholder', 
  'exploring', 'explored', 
  'retrieving', 'retrieved',
  'grepping', 'grepped', 
  'reading', 'read',
  'indexing', 'indexed',
  'analyzing', 'analyzed',
  'storing', 'stored',
  'learning', 'learned',
  'listing_files', 'listed_files',
  'searching_code', 'searched_code',
  'searching_reference', 'searched_reference',
  'command_running', 'command_streaming', 'command'
]);

/**
 * Completed chat status types (used for duplicate detection)
 */
export const COMPLETED_CHAT_STATUS_TYPES = new Set([
  'grepped', 'explored', 'read', 'command', 'learned',
  'listed_files', 'searched_code', 'searched_reference'
]);

/**
 * Base branch names (skip chat persistence)
 */
export const BASE_BRANCH_NAMES = ['main', 'master', 'develop'];

/**
 * Chat status type (for showChatStatus method)
 */
export type ChatStatusType = 
  | 'placeholder' 
  | 'exploring' | 'explored' 
  | 'retrieving' | 'retrieved' 
  | 'grepping' | 'grepped' 
  | 'listing_files' | 'listed_files'
  | 'searching_code' | 'searched_code'
  | 'reading' | 'read' 
  | 'thinking' 
  | 'indexing' | 'indexed' 
  | 'analyzing' | 'analyzed' 
  | 'storing' | 'stored' 
  | 'searching_reference' | 'searched_reference' 
  | 'tool_action' 
  | 'learning' | 'learned' 
  | 'file_create_failed' | 'file_edit_failed' | 'file_delete_failed';
