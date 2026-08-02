/**
 * Clarify continuation helper — consumes the `awaitingClarify` flag set
 * during the previous run and re-injects the user's clarify answer into
 * the per-node conversation history so the next LLM call sees it.
 *
 * Canonical usage pattern (mirrored across agents):
 *   1. Run N: node emits a `<clarify>` card and writes
 *      `awaitingClarify: true` + the conversation snapshot to session state.
 *   2. Run N+1: runner restores `awaitingClarify=true` and `overrideDirective`
 *      (= the user's answer text) onto the graph state.
 *   3. The receiving node calls `consumeAwaitingClarify(state, key)` BEFORE
 *      building LLM messages. This pushes a `{role:'user'}` entry to the
 *      target NODE history and clears the flag — and returns the channel patch
 *      the node must spread into every non-clarify-pause return.
 *
 * Without this step, continuation runs send only the prior assistant message
 * to the LLM (and an injected "Continue." placeholder), so the model never
 * sees the answer and re-asks the same clarify questions.
 */

import { CONV_KEYS, getConv, type ConversationKey, type Conversations } from '../graph/conversations';

/**
 * Minimum structural state shape required for clarify continuation.
 *
 * Intentionally narrow so any agent with a `conversations` Record and the
 * standard clarify fields can call this helper without coupling to its
 * full graph state type.
 */
export interface ClarifyContinuableState {
  conversations: Conversations;
  awaitingClarify?: boolean;
  overrideDirective?: string;
}

/**
 * State patch that ACTUALLY clears the LangGraph channel. The in-place
 * mutation below is node-local only: LangGraph builds the next state from the
 * keys a node RETURNS, so mutating the passed object leaves the channel at its
 * previous value. Spread this patch into every return path of the consuming
 * node except the clarify-pause path (which sets `awaitingClarify: true`).
 */
export type ClarifyConsumePatch = { awaitingClarify?: false };

/**
 * If the previous run paused on a clarify card, push the user's answer
 * (`state.overrideDirective`) onto the given conversation key as a
 * `{role:'user'}` entry, then clear `awaitingClarify`.
 *
 * Mutates `state.conversations` and `state.awaitingClarify` in place so
 * node-internal code paths read the updated values immediately, AND returns the
 * channel patch the caller must merge into its returns. Dropping the return
 * value leaves the channel `true` for the whole run — that is what routed a
 * sealed plan brief to `__end__` instead of `execute` and left the session
 * permanently stuck in continuation mode.
 *
 * No-op (returns `{}`) when `awaitingClarify` is falsy or `overrideDirective`
 * is empty. Idempotent: a second call after the flag is cleared does nothing.
 */
export function consumeAwaitingClarify(
  state: ClarifyContinuableState,
  conversationKey: ConversationKey = CONV_KEYS.NODE_EXECUTE,
): ClarifyConsumePatch {
  if (!state.awaitingClarify || !state.overrideDirective) return {};

  const existing = getConv(state.conversations, conversationKey);
  state.conversations = {
    ...state.conversations,
    [conversationKey]: [
      ...existing,
      { role: 'user', content: state.overrideDirective },
    ],
  };
  state.awaitingClarify = false;
  return { awaitingClarify: false };
}
