import { StateCreator } from 'zustand';

/**
 * Chat-related state and actions
 * Manages programmatic chat input (templates, quick actions, fix requests, etc.)
 */

export interface ChatState {
  // ✅ Programmatic chat input (set by any feature, consumed by ChatInput)
  pendingChatInput: PendingChatInput | null;
}

/**
 * Pending chat input from any source
 * - Quick actions (e.g., "/help", "/status")
 * - Templates (e.g., bug report template)
 * - Suggestions (e.g., AI suggestions)
 * - Fix requests (e.g., dev server validation failure)
 */
export interface PendingChatInput {
  message: string;
  // ✅ Optional: Auto-switch job type
  jobType?: 'design' | 'code' | 'learn';
  // ✅ Optional: Auto-submit after inserting
  autoSubmit?: boolean;
  // ✅ Optional: Source for tracking/debugging
  source?: string;
}

export interface ChatActions {
  /**
   * Set pending chat input (consumed by ChatInput)
   * Used by: Fix buttons, quick actions, templates, suggestions, etc.
   */
  setPendingChatInput: (input: PendingChatInput | null) => void;
}

export type ChatSlice = ChatState & ChatActions;

export const createChatSlice: StateCreator<any, [], [], ChatSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  pendingChatInput: null,

  // ==================
  // Actions
  // ==================
  setPendingChatInput: (input) => {
    if (input) {
      console.log(`[ChatSlice] 💬 Pending input set:`, {
        messageLength: input.message.length,
        jobType: input.jobType,
        autoSubmit: input.autoSubmit,
        source: input.source,
      });

      // Auto-switch job type if requested
      if (input.jobType && get().selectedJobType !== input.jobType) {
        console.log(`[ChatSlice] 🔄 Auto-switching job type: ${get().selectedJobType} → ${input.jobType}`);
        get().setSelectedJobType(input.jobType);
      }
    }

    set({ pendingChatInput: input });
  },
});

