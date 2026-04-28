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
  | 'plan_start'
  | 'plan_content'
  | 'plan_end'
  | 'clarify_start'
  | 'exploration_start'
  | 'exploration_progress'
  | 'exploration_complete'
  | 'task_added';

export interface ParsedAction {
  type: ParsedActionType;
  data: {
    content?: string;
    filePath?: string;
    actionType?: 'create' | 'append' | 'edit' | 'delete';
    metadata?: Record<string, any>;
    blockStart?: boolean;  // For thinking: marks <thinking> tag opened (new block)
    blockEnd?: boolean;    // ✅ For thinking: marks </thinking> tag closed (duration calc)
    durationMs?: number;   // ✅ For thinking: duration in milliseconds (from LLM or local timer)
    /**
     * `task_added` — raw JSON body of a single `<task>...</task>` element
     * extracted from the decompose stream. Consumed by the decompose
     * llmCaller's `onAction` hook for partial Kanban broadcast; chat
     * rendering is a no-op (see CommonRenderStrategy).
     */
    rawJson?: string;
  };
}

// ============================================================================
// Stream Result
// ============================================================================

/** Cross-worker file conflict with both contents for direct merge */
export interface FileConflict {
  path: string;
  intendedContent: string;
  currentContent: string;
  ownerTask?: string;
}

export interface StreamResult {
  raw: string;
  streamedFiles: string[];
  completedActions: ParsedAction[];
  fileErrors?: string[];  // ✅ File operation errors for self-healing
  fileConflicts?: FileConflict[];  // ✅ Cross-worker conflicts for direct merge (bypasses enforce/plan)
  explicitDone?: boolean; // ✅ True if LLM output <done>true</done> explicitly
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

