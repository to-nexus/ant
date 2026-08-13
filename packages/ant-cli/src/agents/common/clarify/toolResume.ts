/**
 * Clarify end-and-resume seam (canonical-migration seam #2).
 *
 * The clarify TOOL pauses by ENDING the job normally: the session seals with
 * the assistant `tool_use('clarify')` dangling (no tool_result). The next
 * turn — whatever its content: a card answer, a partial answer, or an
 * unrelated message — must close that call so the provider transcript stays
 * valid. One framing ("User replied:\n…") covers every case; the model infers
 * non-answers from content, exactly as canonical's overrideDirective
 * injection does.
 *
 * Detection is STRUCTURAL (tail assistant message ending in a clarify
 * tool_use) — the seal's `awaitingClarify` marker is advisory only, because
 * the provider constraint being protected is itself structural.
 */

import { CLARIFY_TOOL_NAME } from './tool';

export interface DanglingClarifyToolUse {
  toolUseId: string;
  question: string;
}

interface MessageLike {
  role: string;
  content: string | Array<Record<string, any>>;
}

/**
 * Detect a dangling clarify tool_use at the tail of a conversation history.
 * Returns null unless the LAST message is an assistant turn whose content
 * array's LAST block is a `tool_use` named clarify.
 */
export function findDanglingClarifyToolUse(history: MessageLike[] | undefined): DanglingClarifyToolUse | null {
  if (!history || history.length === 0) return null;
  const tail = history[history.length - 1];
  if (!tail || tail.role !== 'assistant' || !Array.isArray(tail.content)) return null;
  const lastBlock = tail.content[tail.content.length - 1];
  if (!lastBlock || lastBlock.type !== 'tool_use' || lastBlock.name !== CLARIFY_TOOL_NAME) return null;
  if (typeof lastBlock.id !== 'string' || lastBlock.id.length === 0) return null;
  const question = typeof lastBlock.input?.question === 'string' ? lastBlock.input.question : '';
  return { toolUseId: lastBlock.id, question };
}

/**
 * Build the user turn that closes a dangling clarify tool_use with the next
 * user input as its tool_result.
 */
export function buildClarifyToolResultTurn(
  toolUseId: string,
  text: string,
): { role: 'user'; content: Array<Record<string, any>> } {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        tool_name: CLARIFY_TOOL_NAME,
        content: `User replied:\n${text}`,
      },
    ],
  };
}
