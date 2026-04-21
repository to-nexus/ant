/**
 * Clarify LLM tool definition + handler.
 *
 * Exposes the `clarify` tool to LLM tool loops (currently decompose).
 * The tool lets the LLM pause a job and ask the user a free-form question.
 *
 * Intent-gate policy: `CLARIFY_TOOL` is a CONTENT-level clarify surface —
 * the LLM pauses the same job and resumes with user input. It does NOT
 * switch intents, unlike `<specClarify>` whose `redirect_to_design`
 * option changes the active job. Therefore this module does not consult
 * `isIntentCommitted`. See `agents/common/intentCommit.ts` for the
 * rationale and which surfaces ARE intent-gated.
 */

import type { ToolDefinition } from '../../../core/ports/llm';
import { sendClarify } from './transport';

export const CLARIFY_TOOL: ToolDefinition = {
  name: 'clarify',
  description:
    'Ask the user a clarifying question when the directive is genuinely ' +
    'ambiguous in its CONTENT (which specific files, which feature subset, ' +
    'which behavior variant). Do NOT use this to re-adjudicate the active ' +
    'intent itself — intent is already committed upstream. This pauses the ' +
    'current operation and waits for user response. Use sparingly.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The clarifying question to ask the user',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional predefined answer choices',
      },
    },
    required: ['question'],
  },
};

export interface ClarifyContext {
  clarifySent: boolean;
}

export function createClarifyContext(): ClarifyContext {
  return { clarifySent: false };
}

/**
 * Handle a clarify LLM tool call: send cards and mark context.
 * Returns a sentinel string visible to the LLM as the tool result.
 */
export async function handleClarify(
  args: { question: string; options?: string[] },
  ctx: ClarifyContext,
): Promise<string> {
  await sendClarify([{
    question: args.question,
    options: args.options || [],
    allowFreeText: true,
  }]);
  ctx.clarifySent = true;
  return '[CLARIFY_SENT] Operation paused. Waiting for user response.';
}
