import { LearnGraphState } from "../state";
import { storeLessons } from "../../../memory/storage";

export async function store(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  
  try {
    // Show storing status
    await chatAPI.showChatStatus('storing', {
      message: `${state.texts.length} lesson(s)...`
    });
    
    const joined = state.texts.join("\n\n---\n\n");
    await storeLessons(joined, state.context.project, state.context.featureFolder || "default");
    
    // Show stored completion
    await chatAPI.showChatStatus('stored', {
      message: `${state.texts.length} lesson(s) successfully`
    });
    
    return state;
    
  } catch (error: any) {
    // ✅ CRITICAL: Update status to stored (failed) before throwing
    console.error(`❌ Storing lessons failed:`, error);
    
    await chatAPI.showChatStatus('stored', {
      error: error.message
    });
    
    throw error;
  }
}
