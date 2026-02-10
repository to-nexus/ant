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
    
    // Send eval save choice card if this was an evaluation
    if (state.isEvaluation && state.featurePath) {
      await sendEvalSaveChoice(state);
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
  
  // Send eval save choice card if this was an evaluation
  if (state.isEvaluation && state.featurePath) {
    await sendEvalSaveChoice(state);
  }
  
  return {};
}

/**
 * Send a choice card asking the user if they want to save the evaluation report.
 * Starts a new message, sends the choice card, and finalizes it.
 */
async function sendEvalSaveChoice(state: AskGraphState): Promise<void> {
  const chatAPI = getChatAPIClient();
  
  const evalTypeLabel = state.evalType === 'all' ? 'Full Evaluation' : `${state.evalType} Evaluation`;
  
  try {
    await chatAPI.sendChoiceCard({
      type: 'eval_save',
      title: state.language === 'ko' 
        ? `📋 ${evalTypeLabel} 평가 리포트를 저장하시겠습니까?`
        : `📋 Save ${evalTypeLabel} report?`,
      choices: [
        {
          id: 'save',
          label: state.language === 'ko' ? '저장' : 'Save',
          action: 'eval_save',
          data: {
            evalType: state.evalType,
            featurePath: state.featurePath,
            response: state.response,
          },
        },
        {
          id: 'skip',
          label: state.language === 'ko' ? '건너뛰기' : 'Skip',
          action: 'dismiss',
        },
      ],
    });
    // Finalize the choice card message (showChatStatus auto-starts a new message)
    await chatAPI.finalizeMessage();
    console.log('📋 [Respond] Eval save choice card sent');
  } catch (error) {
    console.warn('⚠️ [Respond] Failed to send eval save choice card:', error);
  }
}
