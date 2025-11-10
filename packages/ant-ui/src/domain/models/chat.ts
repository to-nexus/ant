/**
 * Chat Message Types
 * 
 * Types for AI agent chat interface (Cursor-style)
 */

export type MessageRole = 'user' | 'assistant';

export type MessageContentType = 
  | 'thinking'    // AI's internal reasoning (collapsible)
  | 'text'        // Text response
  // File Operations - Real-time streaming
  | 'file_creating'  // File creation started (header only)
  | 'file_writing'   // File being written (real-time code streaming)
  | 'file_create'    // File creation complete (collapsible)
  | 'file_editing'   // File edit started (header only)
  | 'file_updating'  // File being updated (real-time diff streaming)
  | 'file_edit'      // File edit complete (collapsible)
  | 'file_deleting'  // File deletion started
  | 'file_delete'    // File deletion complete
  // Command Execution - Real-time streaming
  | 'command_running'   // Command started (header only)
  | 'command_streaming' // Command output streaming
  | 'command'           // Command complete (collapsible)
  // Exploration & Analysis
  | 'exploring'   // Scanning codebase (in progress)
  | 'explored'    // Codebase scan complete
  | 'reading'     // Reading file (in progress)
  | 'read'        // File read complete
  | 'grepping'    // Searching codebase (in progress)
  | 'grepped';    // Search complete

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
    // Exploration & Analysis
    filesCount?: number;    // For explored/grepped
    totalFiles?: number;    // For exploring/grepping progress
    tokensCount?: number;   // For explored
    strategy?: string;      // For grepped (git/vector/keyword)
    filesList?: string[];   // List of files (for explored/grepped)
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

