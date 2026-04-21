/**
 * Clarify transport — ChatAPIClient bridge.
 */

import type { ClarifyBlock } from './types';

/**
 * Send clarify cards to the user via ChatAPIClient.
 * This is the shared transport used by both tool handlers and direct callers.
 */
export async function sendClarify(blocks: ClarifyBlock[]): Promise<void> {
  const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.sendClarifyCards(blocks);
  await chatAPI.finalizeMessage();
}
