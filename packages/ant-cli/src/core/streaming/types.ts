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

export interface StreamResult {
  raw: string;
  completedActions: ParsedAction[];
  explicitDone?: boolean; // ✅ True if LLM output <done>true</done> explicitly
}
