/**
 * Chat domain model — Phase 11 chat-SSOT slim-down.
 *
 * The legacy `ChatMessage` / `MessageContent` / `MessageContentType` /
 * `ChatSession` envelopes have been removed. The presentation layer
 * consumes the SSOT projector output (`Turn[]`) directly from
 * `selectors/chat.ts`, and card components consume `ChatStatusLine`
 * / `ChatChoicePresentedLine` / `ChatChoiceResolvedLine` from
 * `@ant/shared`.
 *
 * `FileStats` remains a presentation-only aggregate (file-operation
 * counts + paths) used by `ChatInput`'s file-change summary chip.
 * Wire `selectFileStats` from the projector to populate it.
 */

/**
 * File Statistics — count of file operations in current conversation.
 */
export interface FileStats {
  filesEdited: number;
  filesCreated: number;
  filesDeleted: number;
  totalFiles?: number;
  /** File list details (for collapsible view). */
  files?: Array<{
    path: string;
    operation: 'create' | 'edit' | 'delete';
  }>;
}
