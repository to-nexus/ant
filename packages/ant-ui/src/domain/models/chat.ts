/**
 * Chat Message Types
 * 
 * Types for AI agent chat interface (Cursor-style)
 */

export type MessageRole = 'user' | 'assistant';

export type MessageContentType = 
  // 🎯 Chat Status Messages (progress indicators only)
  | 'placeholder'    // "Planning next moves..." (system-generated, shown at node start)
  | 'exploring'      // Scanning codebase for git changes (in progress)
  | 'explored'       // Git changes exploration complete
  | 'retrieving'     // Vector DB search (in progress)
  | 'retrieved'      // Vector DB search complete
  | 'grepping'       // Local file search fallback (in progress)
  | 'grepped'        // Local file search complete
  | 'listing_files'  // Listing files in directory (in progress)
  | 'listed_files'   // File listing complete
  | 'searching_code' // Searching code patterns (in progress)
  | 'searched_code'  // Code search complete
  | 'reading'        // Reading file (in progress)
  | 'read'           // File read complete
  | 'reading_source' // Reading source document (in progress)
  | 'read_source'    // Source document read complete
  | 'indexing'       // Codebase indexing (in progress)
  | 'indexed'        // Codebase indexing complete
  | 'analyzing'      // Analysis in progress
  | 'analyzed'       // Analysis complete
  | 'loading'        // Loading required files (in progress)
  | 'loaded'         // Required files loaded
  | 'storing'        // Storing lessons (in progress)
  | 'stored'         // Storing lessons complete
  | 'learning'       // Learning from code changes (in progress)
  | 'learned'        // Learning complete
  | 'processing'     // Visual post-processing in progress (bg removal, upscale, etc.)
  | 'processed'      // Visual post-processing complete
  | 'downloading'    // Asset download in progress (Figma design)
  | 'downloaded'     // Asset download complete
  | 'figma_calling'  // Figma MCP tool call in progress
  | 'figma_called'   // Figma MCP tool call complete
  // General content (Chat Status Messages HIDE when these arrive)
  | 'thinking'       // LLM's thought process (collapsible block, accumulates, multiple blocks possible)
  | 'text'           // General text response
  | 'cancelled'      // Task cancelled by user (with Resume button)
  // File Operations - Real-time streaming
  | 'file_creating'  // File creation started (header only)
  | 'file_writing'   // File being written (real-time code streaming)
  | 'file_create'    // File creation complete (collapsible)
  | 'file_create_failed'  // File creation failed
  | 'file_editing'   // File edit started (header only)
  | 'file_updating'  // File being updated (real-time diff streaming)
  | 'file_edit'      // File edit complete (collapsible)
  | 'file_edit_failed'    // File edit failed (search block not found, etc.)
  | 'file_deleting'  // File deletion started
  | 'file_delete'    // File deletion complete
  | 'file_delete_failed'  // File deletion failed
  // Context Loaded - Informational notification for loaded context
  | 'context_loaded'  // Context loaded notification (eval report, PRD, design docs, etc.)
  // Tool Actions - Cursor/Copilot style (minimal, one-line display)
  | 'tool_action'    // Simple tool actions (mkdir, etc.) - ✓ Created organisms/, templates/
  // Command Execution - Real-time streaming
  | 'command_running'   // Command started (header only)
  | 'command_streaming' // Command output streaming
  | 'command'           // Command complete (collapsible)
  // Triage System - User choice
  | 'triage_choice'     // Triage choice card (with buttons)
  // Generic Choice Cards
  | 'choice_card'      // Generic choice card (eval_save, clarifying, spec_complete, etc.)
  // Plan Card - Real-time streaming (code job plan node)
  | 'plan_generating'  // Plan generation in progress (streaming)
  | 'plan'             // Plan generation complete
  // Task Response Card - Worker graph text output (parallel-safe)
  | 'task_response';   // Worker node text in contained card

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
    originalType?: string;  // For cancelled: original work type that was cancelled
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
    detail?: string;        // Additional detail message (for indexing, analyzing, etc.)
    // Tool Actions
    toolName?: string;      // For tool_action: tool name (mkdir, etc.)
    actionIcon?: string;    // For tool_action: emoji/icon to display
    // Metadata
    provider?: string;      // 'system' or 'llm'
    model?: string;         // LLM model name
    blockStart?: boolean;   // For thinking: marks <thinking> tag opened (new block)
    durationMs?: number;    // For thinking: duration in milliseconds
    collapsed?: boolean;    // For thinking: marks if the block should be collapsed
    // Triage Choice
    choiceOptions?: {       // For triage_choice
      positive: { label: string; action: string };
      negative: { label: string; action: string };
      neutral?: { label: string; action: string };
    };
    choiceSelected?: string;  // Selected action (after user choice)
    resolvedLabel?: string;   // Label to display after choice is made
    resolved?: boolean;       // For cancelled: marked true when user resumes/continues (server-set)
    // Generic Choice Card
    cardType?: string;        // For choice_card: 'eval_save' | 'clarifying' | 'spec_complete'
    specFile?: string;         // For spec_complete: spec filename (e.g. spec-social-login.md)
    title?: string;           // For choice_card: card title
    evalType?: string;        // For eval_save: type of evaluation
    evalContent?: string;     // For eval_save: evaluation content to save
    // Clarifying Choice Card — compound card (planner generate mode, visual draft selection)
    clarifyBlocks?: Array<{
      question: string;
      options: Array<string | {
        label: string;
        imagePath: string;
        thumbnailPath: string;
        value: string;
      }>;
      allowFreeText?: boolean;
      allowRegenerate?: boolean;
    }>;
    resolvedAnswers?: Record<number, string>;  // For clarifying: per-question answers after submission
    customText?: string;  // For clarifying: free-text feedback submitted
    // Context Loaded
    items?: Array<{ label: string; detail?: string }>;  // For context_loaded: loaded items
    // Plan card
    taskName?: string;        // For plan_generating/plan/task_response: task name in header
    completed?: boolean;      // For task_response: individual card completion signal
    // Image preview (for figma_called, downloaded, read — when result is an image)
    imagePath?: string;       // Feature-relative path to saved image file
    selectedDraftIndex?: number;  // Persisted after user selects a draft
    // File card summary (lightweight persistence — content stripped, stats kept)
    lineCount?: number;       // Total lines written (file_create)
    // Lines removed. Set by:
    //   - completeFileEdit (edit_file tool path)
    //   - completeFileCreation with overwrite (<file> tag on existing file)
    // FileCard uses this to render `+Y -X` instead of bare `+Y` for overwrites.
    diffBeforeLines?: number;
    diffAfterLines?: number;  // Lines added (file_edit)
  };
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  contents: MessageContent[];  // A message can have multiple content blocks
  timestamp: string;
  isStreaming?: boolean;  // Currently being streamed
  actionMetadata?: import('@ant/shared').ActionMetadata;
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

