/**
 * Full-job ask fallback (E2-5 — context-lens remainder)
 *
 * When a full job's (learn/design/code) triage classifies the turn as
 * `group === 'ask'`, the graph ends at `__end__` without producing an
 * answer — Phase D's `routeToAskGraph` was never wired in-graph. This
 * helper is the out-of-graph seam: architect/index.ts calls it before
 * returning, reusing the exact inline-ask dispatch wiring (P1 rich tail →
 * runAskGraph → ephemeral assistant_turn distill).
 *
 * The ask graph streams its own chat output (agent node → ChatAPIClient),
 * so the caller only swaps the returned `message` for the real answer.
 * Failure policy: log + return undefined — an ask miss must never turn a
 * classified-ask turn into a crashed job (the caller falls back to the
 * previous placeholder message).
 */

import type { WorkspaceState } from '../../../common/graph/nodes/triage/types';

export interface FullJobAskParams {
  /** The user question — recover from graph state (overrideDirective || directive). */
  question: string;
  language: 'ko' | 'en';
  featurePath?: string;
  projectId: string;
  currentJob: 'learn' | 'design' | 'code';
  currentAgent?: string;
  /** Triage-produced workspace snapshot from the final graph state. */
  workspaceState?: WorkspaceState;
  llm?: unknown;
  jobId?: string;
  /** Current turn id (hydrated by triage) — excluded from the rich-tail scan. */
  turnId?: string;
}

/**
 * Run the ask graph for a full-job turn that triage grouped as 'ask'.
 * Returns the answer text, or undefined when prerequisites are missing
 * or the graph fails (caller keeps its placeholder message).
 */
export async function answerFullJobAsk(params: FullJobAskParams): Promise<string | undefined> {
  const { question, language, featurePath, projectId, currentJob, currentAgent, workspaceState, llm, jobId, turnId } = params;

  if (!featurePath || !workspaceState || !llm || !question.trim()) {
    console.warn(
      `⚠️ [FullJobAsk] skipped: missing prerequisites (featurePath=${!!featurePath}, workspaceState=${!!workspaceState}, llm=${!!llm})`,
    );
    return undefined;
  }

  try {
    // P1 rich tail — same wiring as orchestrator's runInlineAskDispatch.
    const { FileSessionAdapter } = await import('../../../../periphery/adapters/session/FileSessionAdapter');
    const { buildChatTail } = await import('../../../../core/context/chatTailBuilder');
    const askSession = new FileSessionAdapter(featurePath, 'architect', projectId);
    const recentConversation = await buildChatTail(askSession, { excludeTurnId: turnId });
    if (recentConversation) {
      console.log(`📚 [FullJobAsk] rich tail: ${recentConversation.exchanges.length} exchanges`);
    }

    const { runAskGraph } = await import('./runner');
    const askResult = await runAskGraph({
      question,
      language,
      workspaceState: { ...workspaceState, featurePath },
      currentJob,
      currentAgent: currentAgent || 'architect',
      deps: { llm },
      _httpJobId: jobId,
      recentConversation,
    });

    // Context Lens P2 — ephemeral assistant_turn so follow-ups resolve
    // without re-reading chat.jsonl. Same gate as inline-ask dispatch.
    if (jobId && turnId) {
      const { distillAssistantTurn } = await import('../../../../core/context/assistantTurn');
      await distillAssistantTurn({
        session: askSession,
        jobId,
        turnId,
        jobType: 'ask',
        directive: question,
        ephemeral: true,
        finalTextOverride: askResult.response || '',
      });
    }

    return askResult.response || undefined;
  } catch (err) {
    console.warn(`⚠️ [FullJobAsk] ask graph failed (job=${currentJob}):`, err);
    return undefined;
  }
}
