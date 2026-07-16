import { StateCreator } from 'zustand';

/**
 * Chat-related state and actions
 * Manages programmatic chat input (templates, quick actions, fix requests, etc.)
 */

export interface ChatState {
  // ✅ Programmatic chat input (set by any feature, consumed by ChatInput)
  pendingChatInput: PendingChatInput | null;
  /**
   * cardId of the subagent_report card whose full report overlay is open.
   * Lives in the store (not card-local state) because cards are inside the
   * Virtuoso-virtualized list and unmount when scrolled out — the overlay
   * mounts at ChatPanel level and must outlive the card instance.
   */
  openSubagentReportCardId: string | null;
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
  jobType?: 'design' | 'code' | 'learn' | 'plan';
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
  /** Open the explore-report overlay for a subagent_report card. */
  openSubagentReport: (cardId: string) => void;
  /** Close the explore-report overlay. */
  closeSubagentReport: () => void;
}

export type ChatSlice = ChatState & ChatActions;

export const createChatSlice: StateCreator<any, [], [], ChatSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  pendingChatInput: null,
  openSubagentReportCardId: null,

  // ==================
  // Actions
  // ==================
  openSubagentReport: (cardId) => set({ openSubagentReportCardId: cardId }),
  closeSubagentReport: () => set({ openSubagentReportCardId: null }),

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

      // Accumulate manual (non-autoSubmit) fixes that haven't been consumed by
      // ChatInput yet — clicking Fix on several connections before opening the
      // chat must batch into ONE message, not let the last overwrite the rest.
      const existing = get().pendingChatInput as PendingChatInput | null;
      if (existing && !existing.autoSubmit && !input.autoSubmit) {
        set({
          pendingChatInput: {
            ...input,
            message: `${existing.message.trimEnd()}\n\n${input.message}`,
          },
        });
        return;
      }
    }

    set({ pendingChatInput: input });
  },
});

