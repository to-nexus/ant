/**
 * Core types for the streaming system
 * 
 * NOTE: LLMStreamEvent is now in core/ports/llm.ts (unified with LLM interface)
 */

// ============================================================================
// Parsed Actions
// ============================================================================

export type ParsedActionType =
  | 'thinking'
  | 'response'
  | 'file_start'
  | 'file_content'
  | 'file_end'
  | 'exploration_start'
  | 'exploration_progress'
  | 'exploration_complete';

export interface ParsedAction {
  type: ParsedActionType;
  data: {
    content?: string;
    filePath?: string;
    actionType?: 'create' | 'append' | 'edit' | 'delete';
    metadata?: Record<string, any>;
    blockStart?: boolean;  // For thinking: marks <thinking> tag opened (new block)
    blockEnd?: boolean;    // ✅ For thinking: marks </thinking> tag closed (duration calc)
  };
}

// ============================================================================
// Stream Result
// ============================================================================

export interface StreamResult {
  raw: string;
  streamedFiles: string[];
  completedActions: ParsedAction[];
}

// ============================================================================
// File Stream Info
// ============================================================================

export interface FileStreamInfo {
  filePath: string;
  actionType: 'create' | 'append' | 'edit' | 'delete';
  startedAt: number;
  contentBuffer: string;
}

