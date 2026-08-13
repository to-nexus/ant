/**
 * Clarify TOOL — the unified blocking-question trigger (canonical-migration
 * seam #1).
 *
 * Phase 1 consumer is the universal runtime; canonical surfaces (planner
 * plan, design decompose/execute, code decompose, visual) migrate onto this
 * definition in follow-up commits, retiring the `<clarify>` tag last.
 *
 * The tool is a RUNTIME-ADVERTISED CONTROL TOOL: it lives outside the
 * builtin preset planes (no ToolName entry, no JOB_TOOL_MATRIX row, no
 * registry handler). Availability is enforced by ABSENCE from the advertised
 * tool list (definition knob + session budget), never by a strip/proceed-note
 * pass over emitted calls.
 */

import type { ClarifyBlock } from './types';

export const CLARIFY_TOOL_NAME = 'clarify';

/**
 * The autonomy contract lives in the description: the model may only reach
 * for this when it cannot proceed, and calling it ends the turn.
 */
export const CLARIFY_TOOL_DEFINITION = {
  name: CLARIFY_TOOL_NAME,
  description:
    'Ask the user ONE blocking question and wait for their answer. ' +
    'Use this ONLY when you cannot proceed without the answer — otherwise proceed with a sensible default and state the assumption you made. ' +
    'This must be the ONLY tool call of its round (do not combine it with other tool calls). ' +
    'Calling it ends the current turn; work resumes when the user replies.',
  input_schema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string' as const,
        description: 'The single blocking question, phrased so the user can answer in one message.',
      },
      options: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Optional short answer choices presented as selectable options.',
      },
      allowFreeText: {
        type: 'boolean' as const,
        description: 'Whether a free-text answer is accepted alongside the options (default true).',
      },
    },
    required: ['question'],
  },
};

/**
 * Validate + convert clarify tool-call args into the shared ClarifyBlock.
 * Returns an error string (for a rejection tool_result) on invalid input.
 */
export function clarifyBlockFromArgs(args: Record<string, unknown>): ClarifyBlock | string {
  const question = args['question'];
  if (typeof question !== 'string' || question.trim().length === 0) {
    return 'clarify requires a non-empty "question" string.';
  }
  const rawOptions = args['options'];
  let options: string[] = [];
  if (rawOptions != null) {
    if (!Array.isArray(rawOptions) || rawOptions.some((o) => typeof o !== 'string')) {
      return 'clarify "options" must be an array of strings.';
    }
    options = (rawOptions as string[]).map((o) => o.trim()).filter((o) => o.length > 0);
  }
  const allowFreeText = args['allowFreeText'];
  if (allowFreeText != null && typeof allowFreeText !== 'boolean') {
    return 'clarify "allowFreeText" must be a boolean.';
  }
  return {
    question: question.trim(),
    options,
    allowFreeText: (allowFreeText as boolean | undefined) ?? true,
  };
}
