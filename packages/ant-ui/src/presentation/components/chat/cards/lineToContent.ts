/**
 * Card-internal adapter — turns the SSOT pair `(ChatStatusLine, PendingCardSnapshot?)`
 * into the legacy `{ type, content, metadata }` shape that the existing
 * card bodies still consume internally.
 *
 * Phase 11 of the chat-SSOT unification flips card props from the legacy
 * `MessageContent` envelope to the SSOT line + streaming-buffer pair.
 * Card bodies are large render trees that lean on `content.type`,
 * `content.content` and `content.metadata?.foo` everywhere — fully
 * rewriting them in this phase would be high-risk for zero behavioural
 * gain. Instead, every card bridges the new prop pair through this
 * helper at the top of the file and keeps its rendering body verbatim.
 *
 * Phase 13 (testing pass) is a natural place to revisit individual cards
 * and inline the `line.metadata` accessors directly when the test
 * coverage exists.
 */

import type {
  ChatStatusLine,
  ChatStatusType,
  PendingCardSnapshot,
} from '@ant/shared';
import { generateChatStatusContent } from '@ant/shared';

/**
 * Local-only mirror of the legacy `MessageContent` shape, scoped to
 * card render bodies. Exported so cards can type their internal
 * `content` variable without re-importing the deprecated domain model.
 */
export interface CardContent {
  type: ChatStatusType;
  content: string;
  metadata: Record<string, any> & { cardId?: string };
}

/**
 * Build the card-internal `content` shape from a `ChatStatusLine` plus
 * its optional in-flight `PendingCardSnapshot`.
 *
 * Body resolution order:
 *  1. `pending.streamedOutput` — live stdout / diff growth before
 *     the card finalizes.
 *  2. `generateChatStatusContent(statusType, metadata)` — durable
 *     render produced by the shared serializer.
 *
 * `metadata.cardId` is stamped onto the projected envelope so legacy
 * sibling-lookup paths (now removed) and component keys can still
 * reference the card identity without a separate prop.
 */
export function lineToContent(
  line: ChatStatusLine,
  pending?: PendingCardSnapshot,
): CardContent {
  const body =
    pending?.streamedOutput ??
    generateChatStatusContent(line.statusType, line.metadata as any);
  return {
    type: line.statusType,
    content: body,
    metadata: {
      ...((line.metadata ?? {}) as Record<string, any>),
      cardId: line.cardId,
    },
  };
}
