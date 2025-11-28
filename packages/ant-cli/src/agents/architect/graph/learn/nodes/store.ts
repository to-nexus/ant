import { LearnGraphState } from "../state";
import { storeLessons } from "../../../memory/storage";

export async function store(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const joined = state.texts.join("\n\n---\n\n");
  await storeLessons(joined, state.context.project, state.context.featureFolder || "default");
  
  // Show stored completion and end message
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();
  await chatAPI.showChatStatus('stored', {
    message: `Stored ${state.texts.length} lesson(s) successfully`
  });
  
  // ✅ End the assistant message
  await chatAPI.endMessage();
  
  return state;
}
