import { LearnGraphState } from "../state";
import { storeLessons } from "../../../memory/storage";

export async function store(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  
  try {
    // Show storing status and get index
    const mergeIndex = await chatAPI.showChatStatus('storing', {
      message: `${state.texts.length} lesson(s)...`
    });
    
    const joined = state.texts.join("\n\n---\n\n");
    await storeLessons(joined, state.context.project, state.context.featureFolder || "default");
    
    // Show stored completion with merge
    await chatAPI.showChatStatus('stored', {
      message: `${state.texts.length} lesson(s) successfully`,
      _mergeIndex: mergeIndex
    });
    
    return state;
    
  } catch (error: any) {
    // ✅ CRITICAL: Update status to stored (failed) before throwing
    console.error(`❌ Storing lessons failed:`, error);
    
    // Note: mergeIndex might be undefined if storing status wasn't shown yet
    await chatAPI.showChatStatus('stored', {
      error: error.message
    });
    
    throw error;
  }
}
