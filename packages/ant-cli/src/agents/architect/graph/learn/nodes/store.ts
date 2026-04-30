import { LearnGraphState } from "../state";
import { storeLessons } from "../../../memory/storage";
import { isVectorDbEnabled } from "../../../../../core/config/vectorDbCapability";

export async function store(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const chatAPI = (await import('../../../../../core/adapters/ChatAPIClient')).getChatAPIClient();

  // ✅ Capability gate (SSOT: core/config/vectorDbCapability.ts).
  // No `storing`/`stored` chat status is emitted when vector DB is disabled —
  // the upstream orchestrator gate already shows an `indexed` notice with
  // the disabled reason, so we exit silently to avoid a misleading second UI
  // line.
  if (!isVectorDbEnabled()) {
    return state;
  }

  // ✅ Capability gate passed → deps.memory must be the real adapter wired
  // by orchestrator.ts. Pass it through to storeLessons so text-learn lessons
  // actually land in the vector store (prior to this change, the deps
  // argument was omitted and storeLessons silently no-op'ed regardless of
  // capability state — see vectorDbCapability invariant in CLAUDE.md).
  const memory = state.deps?.memory;
  if (!memory) {
    throw new Error(
      "MemoryPort is required for storing lessons. " +
        "Caller must wire `deps.memory` (DI bug)."
    );
  }

  try {
    // Show storing status and get index
    const mergeIndex = await chatAPI.showChatStatus('storing', {
      message: `${state.texts.length} lesson(s)...`
    });
    
    const joined = state.texts.join("\n\n---\n\n");
    await storeLessons(
      joined,
      state.context.project,
      state.context.featureFolder || "default",
      { memory }
    );
    
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
