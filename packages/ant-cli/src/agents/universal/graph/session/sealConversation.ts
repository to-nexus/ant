/**
 * Universal seal — the conversation array that goes to disk.
 *
 * `state.conversations['session:main']` grows monotonically: the runner restores
 * it and appends this turn, and the prompt-side `compactRun` never touches the
 * persisted copy (it compacts a throwaway array for the LLM). Nothing bounded
 * what was written, so a long-lived custom job could grow its own session past
 * the read budget and brick itself (M-NEW-029).
 *
 * The writer refuses over-budget sessions as a backstop; trimming here is what
 * keeps that backstop unreachable in normal operation. Both seal sites (respond's
 * full seal and the runner's error-path save) call this, so the rule has one
 * owner rather than one-per-writer.
 */

import type { UniversalChecklist } from '@ant/shared';
import { trimConversationToByteBudget } from '../../../../core/session/stateBudget';
import type { ConversationMessage } from '../../../../core/context/types';
import { CONV_KEYS } from '../../../common/graph/conversations';

/**
 * Generic over the message shape: the graph's `ConversationMessage` is a
 * superset of the context one (extra `system` role, `timestamp`, `metadata`).
 * The trim only reads `role` and re-emits the same objects, so narrowing the
 * caller's type here would be a lie about what comes back.
 */
export function sealUniversalConversation<T extends { role: string; content: unknown }>(
  history: T[],
): T[] {
  const trim = trimConversationToByteBudget(history as unknown as ConversationMessage[]);
  if (trim.trimmed) {
    console.warn(
      `🗜️  [Universal] Conversation trimmed for persistence: dropped ${trim.droppedTurns} turn(s), ` +
      `${trim.bytesBefore} -> ${trim.bytesAfter} bytes`,
    );
  }
  return trim.messages as unknown as T[];
}

/**
 * The runner's error-path seal state. `updateArtifacts` replaces `state`
 * wholesale, so every field the previous run persisted that this seal omits
 * is deleted from disk — the checklist was lost that way (clear-dotting-mouse).
 */
export function buildUniversalErrorSealState<T extends { role: string; content: unknown }>(args: {
  main: T[];
  customJobRef: string;
  restoredClarifyRounds?: number;
  restoredChecklist?: UniversalChecklist;
}): Record<string, unknown> {
  return {
    conversations: { [CONV_KEYS.SESSION_MAIN]: sealUniversalConversation(args.main) },
    customJobRef: args.customJobRef,
    ...(args.restoredClarifyRounds !== undefined && { clarifyRoundsUsed: args.restoredClarifyRounds }),
    ...(args.restoredChecklist && { checklist: args.restoredChecklist }),
  };
}
