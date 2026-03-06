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
     | 'reading_source' | 'read_source'  // Source document read (design job)
     | 'indexing' | 'indexed'     // Codebase indexing (learn job)
     | 'analyzing' | 'analyzed'   // File analysis (learn job)
     | 'loading' | 'loaded'       // Required files loading (code job)
     | 'storing' | 'stored'       // Lesson storage (learn job)
     | 'learning' | 'learned'     // Codebase learning (code job - post task)
     // General content
     | 'text'
     | 'cancelled'      // Task cancelled (with Resume button)
     | 'triage_choice'  // Triage redirect/blocked choice
     | 'choice_card'    // Generic choice card (eval_save, prd_apply, etc.)
     // File Operations - Real-time streaming
     | 'file_creating' | 'file_writing' | 'file_create' | 'file_create_failed'
     | 'file_editing' | 'file_updating' | 'file_edit' | 'file_edit_failed'
     | 'file_deleting' | 'file_delete' | 'file_delete_failed'
     // File Conflict - Parallel task file conflicts
     | 'file_conflict' | 'file_conflict_retry'
     // Context Loaded - Informational notification
     | 'context_loaded'  // Context loaded notification (eval report, PRD, design docs, etc.)
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
  // Source document reading (reading_source / read_source)
  startLine?: number;     // For reading_source/read_source: start line
  endLine?: number;       // For reading_source/read_source: end line
  totalLines?: number;    // For reading_source/read_source: total lines in file
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
  // Context Loaded metadata
  items?: Array<{ label: string; detail?: string }>;  // For context_loaded: loaded items
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
  'reading_source', 'read_source',
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
  'grepped', 'explored', 'read', 'read_source', 'command', 'learned',
  'listed_files', 'searched_code', 'searched_reference'
]);

/**
 * Informational content types that coexist with placeholder (Universal Placeholder System)
 * 
 * These types do NOT replace an active placeholder when they arrive.
 * Instead, they are added alongside the placeholder so the shimmer animation
 * continues while informational context is displayed.
 * 
 * Example: [placeholder, context_loaded] — shimmer keeps animating while
 * showing "PRD (5,234 chars), Conversation (3 messages)" below it.
 */
export const INFORMATIONAL_TYPES = new Set([
  'context_loaded',
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
  | 'reading_source' | 'read_source'
  | 'thinking' 
  | 'indexing' | 'indexed' 
  | 'analyzing' | 'analyzed' 
  | 'storing' | 'stored' 
  | 'searching_reference' | 'searched_reference' 
  | 'tool_action' 
  | 'learning' | 'learned' 
  | 'context_loaded'  // ✅ Context loaded notification (eval report, PRD, design docs, etc.)
  | 'choice_card'    // ✅ Generic choice card (eval_save, prd_apply, etc.)
  | 'file_create_failed' | 'file_edit_failed' | 'file_delete_failed';
