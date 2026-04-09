/**
 * Shared Clarify Module
 *
 * Unified interface for asking clarifying questions to the user.
 * Used across ALL agent graphs: code decompose, design detect, planner, visual.
 *
 * Two usage patterns:
 *   1. LLM Tool: CLARIFY_TOOL definition + handleClarify handler (tool loop)
 *   2. Direct: sendClarify utility (post-response clarification)
 *
 * UI transport: ChatAPIClient.sendClarifyCards → choice_card (cardType: 'clarifying')
 */

import type { ToolDefinition } from '../../core/ports/llm';

// ============================================
// Types
// ============================================

export type ClarifyOption = string | {
  label: string;
  value: string;
  imagePath?: string;
  thumbnailPath?: string;
};

export interface ClarifyBlock {
  question: string;
  options: ClarifyOption[];
  allowFreeText?: boolean;
  allowRegenerate?: boolean;
}

// ============================================
// Tool Definition (LLM schema)
// ============================================

export const CLARIFY_TOOL: ToolDefinition = {
  name: 'clarify',
  description:
    'Ask the user a clarifying question when you cannot determine the scope or intent. ' +
    'This pauses the current operation and waits for user response. Use sparingly — ' +
    'only when the directive is genuinely ambiguous.',
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

// ============================================
// Context (for tool-based usage)
// ============================================

export interface ClarifyContext {
  clarifySent: boolean;
}

export function createClarifyContext(): ClarifyContext {
  return { clarifySent: false };
}

// ============================================
// Core: Send clarify cards
// ============================================

/**
 * Send clarify cards to the user via ChatAPIClient.
 * This is the shared transport used by both tool handlers and direct callers.
 */
export async function sendClarify(blocks: ClarifyBlock[]): Promise<void> {
  const { getChatAPIClient } = await import('../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.sendClarifyCards(blocks);
  await chatAPI.finalizeMessage();
}

// ============================================
// Tool Handler (for LLM tool loop)
// ============================================

/**
 * Handle a clarify LLM tool call: send cards and mark context.
 * Returns a sentinel string visible to the LLM as the tool result.
 */
export async function handleClarify(
  args: { question: string; options?: string[] },
  ctx: ClarifyContext
): Promise<string> {
  await sendClarify([{
    question: args.question,
    options: args.options || [],
    allowFreeText: true,
  }]);
  ctx.clarifySent = true;
  return '[CLARIFY_SENT] Operation paused. Waiting for user response.';
}
