import { StateCreator } from 'zustand';

/**
 * Chat-related state and actions
 * Manages programmatic chat input (templates, quick actions, fix requests, etc.)
 */

export interface ChatState {
  // ✅ Programmatic chat input (set by any feature, consumed by ChatInput)
  pendingChatInput: PendingChatInput | null;

  /**
   * Worker-group collapse overrides, keyed `${turnId}:${workerScope}`.
   * Stores ONLY explicit user/dock decisions — defaults are derived at
   * render time (workerGroupPolicy.resolveGroupCollapsed). Never persisted;
   * lives here (not uiSlice) because it is chat-session-scoped and must
   * reset with the chat events. MUST NOT flow into the chat projector's
   * inputs (Turn ref stability — autoscroll/pin invariants).
   */
  chatGroupOverrides: Record<string, 'expanded' | 'collapsed'>;

  /**
   * One-shot jump request consumed by ChatHistory (virtuosoRef is private
   * to it). `seq` disambiguates repeated jumps to the same group.
   */
  chatJumpRequest: { turnId: string; workerScope: string; seq: number } | null;
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

  /** Record an explicit collapse decision (component passes the currently
   *  RESOLVED state so the toggle flips against defaults correctly). */
  toggleChatGroup: (turnId: string, workerScope: string, currentlyCollapsed: boolean) => void;
  /** Force a group expanded (dock jump path). */
  expandChatGroup: (turnId: string, workerScope: string) => void;
  /** Request a scroll-to-group jump (consumed by ChatHistory). */
  requestChatJump: (turnId: string, workerScope: string) => void;
  clearChatJump: () => void;
  /** Reset group UI state (feature switch / chat clear). */
  resetChatGroupState: () => void;
}

export type ChatSlice = ChatState & ChatActions;

export const createChatSlice: StateCreator<any, [], [], ChatSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  pendingChatInput: null,
  chatGroupOverrides: {},
  chatJumpRequest: null,

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

  toggleChatGroup: (turnId, workerScope, currentlyCollapsed) => {
    const key = `${turnId}:${workerScope}`;
    set({
      chatGroupOverrides: {
        ...get().chatGroupOverrides,
        [key]: currentlyCollapsed ? 'expanded' : 'collapsed',
      },
    });
  },

  expandChatGroup: (turnId, workerScope) => {
    const key = `${turnId}:${workerScope}`;
    if (get().chatGroupOverrides[key] === 'expanded') return;
    set({
      chatGroupOverrides: { ...get().chatGroupOverrides, [key]: 'expanded' },
    });
  },

  requestChatJump: (turnId, workerScope) => {
    const prev = get().chatJumpRequest;
    set({ chatJumpRequest: { turnId, workerScope, seq: (prev?.seq ?? 0) + 1 } });
  },

  clearChatJump: () => {
    if (get().chatJumpRequest) set({ chatJumpRequest: null });
  },

  resetChatGroupState: () => {
    set({ chatGroupOverrides: {}, chatJumpRequest: null });
  },
});

