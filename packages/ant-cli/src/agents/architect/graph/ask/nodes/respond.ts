/**
 * Respond Node
 * 
 * Final node that ensures response is sent to chat UI.
 * If agent already streamed the response, this node just logs completion.
 * If not (e.g., fallback path), this node sends the response.
 */

import { AskGraphState } from '../state.js';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient.js';

const DEBUG = process.env.ASK_DEBUG === 'true';

/**
 * Respond node - ensure final response is sent to chat
 */
export async function respondNode(state: AskGraphState): Promise<Partial<AskGraphState>> {
  const response = state.response;
  
  if (!response) {
    console.warn('[Respond] No response to send');
    return {};
  }
  
  if (DEBUG) {
    console.log('\n📤 [Respond] Finalizing response...');
    console.log(`   Length: ${response.length} chars`);
    console.log(`   Tool calls made: ${state.toolCalls.length}`);
    console.log(`   Already streamed: ${state.streamingCompleted ? 'yes' : 'no'}`);
  }
  
  // If agent already streamed the response, no need to send again
  if (state.streamingCompleted) {
    if (DEBUG) {
      console.log('   ✅ Response already streamed by agent node');
    }
    return {};
  }
  
  // Fallback: send response if not already streamed
  // This can happen if:
  // 1. Tool calls were made and the final response wasn't streamed
  // 2. Streaming failed and we fell back to invoke
  const chatAPI = getChatAPIClient();
  await chatAPI.startMessage();
  
  // Send as single text event (response is already complete)
  await chatAPI.sendLLMEvent({ type: 'text', text: response });
  
  await chatAPI.finalizeMessage();
  
  if (DEBUG) {
    console.log('   ✅ Response sent to chat (fallback path)');
  }
  
  return {};
}
