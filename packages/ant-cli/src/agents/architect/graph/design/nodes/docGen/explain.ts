/**
 * DocGen / Explain Mode Helper
 *
 * Chat-only response path for design-job explain intents
 * (`explain-sys` / `explain-spec` / `explain-ui` / `explain-game-art` /
 * `explain-visual`). Never emits XML `<file>` blocks and never writes to
 * disk — the entire response is streamed to the chat surface.
 *
 * Entry: `docGen()` early-returns to this helper when
 * `isExplainMode === true` (state.resolvedAction.mode === 'explain' OR
 * state.currentTask.type === 'explain'), so the system-design /
 * design-spec / design-ui branches further down can keep assuming a
 * persisted-artifact contract.
 */
import type { DesignGraphState } from '../../state';
import type { MessageContentBlock } from '../../../../../../core/ports/llm';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import {
  accumulateTokenUsage,
  applyEstimatedInputTokensFromMessages,
  maybeUpdatePhaseTokenUsage,
} from '../../../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { selectArtifacts } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { ARTIFACT_PREFIX } from '@ant/shared';
import type { DesignTask } from '../../../../types/task';

const EXPLAIN_BASE_TEMPLATE = 'jobs/design/nodes/execute/variants/explain-only/base';
const EXPLAIN_RULES_TEMPLATE = 'jobs/design/nodes/execute/variants/explain-only/rules';

const MAX_SOURCE_CHARS = 60_000;

export async function renderExplainResponse(
  state: DesignGraphState,
): Promise<Partial<DesignGraphState>> {
  const llm = state.deps?.llm;
  const pb = state.deps?.promptBuilder;
  if (!llm || !pb) {
    throw new Error('[DocGen/Explain] llm or promptBuilder missing');
  }

  const currentTask = state.currentTask as DesignTask | undefined;
  const sourceArtifacts = selectArtifacts(state.artifacts || [], {
    include: currentTask?.include || [ARTIFACT_PREFIX.SOURCES],
  });
  let sourcesText = sourceArtifacts.map(a => a.content).join('\n\n');
  let sourcesTruncated = false;
  if (sourcesText.length > MAX_SOURCE_CHARS) {
    sourcesText = sourcesText.slice(0, MAX_SOURCE_CHARS);
    sourcesTruncated = true;
  }

  const vars = {
    directive: state.directive || '',
    intent: state.resolvedAction?.intent,
    intentGroup: state.resolvedAction?.intentGroup,
    userLanguage: state.context?.userLanguage || 'en',
    sources: sourcesText,
    hasSources: sourcesText.length > 0,
    sourcesTruncated,
  };

  const [systemBody, rulesBody] = await Promise.all([
    pb.render(EXPLAIN_BASE_TEMPLATE, vars),
    pb.render(EXPLAIN_RULES_TEMPLATE, vars),
  ]);
  const systemPrompt = [systemBody, rulesBody].filter(Boolean).join('\n\n');

  const priorTurns = getConv(state.conversations, CONV_KEYS.NODE_DOCGEN);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | MessageContentBlock[] }> = [
    { role: 'system', content: systemPrompt },
  ];
  if (priorTurns.length > 0) {
    for (const turn of priorTurns) {
      messages.push({ role: turn.role, content: turn.content as any });
    }
  } else {
    messages.push({ role: 'user', content: state.directive || '(no directive provided)' });
  }

  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  applyEstimatedInputTokensFromMessages(state, messages as any);

  let textResponse = '';
  let capturedUsage: any = undefined;

  try {
    for await (const event of llm.stream(messages as any)) {
      if (event.type === 'retry') {
        textResponse = '';
        capturedUsage = undefined;
        continue;
      }
      maybeUpdatePhaseTokenUsage(state, event);
      if (event.type === 'text' && event.text) {
        textResponse += event.text;
        await chatAPI.sendLLMEvent({ type: 'text', text: event.text });
      }
      if (event.type === 'done') {
        const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        await chatAPI.sendLLMEvent(event);
      }
    }
    await chatAPI.finalizeMessage();
  } catch (err) {
    console.error('❌ [DocGen/Explain] Stream failed:', err);
    try { await chatAPI.finalizeMessage(); } catch { /* cleanup */ }
    throw err;
  }

  if (capturedUsage) {
    const { logTokenUsageToFile, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: false });
    updateKanbanTokenUsage(state);
    logTokenUsageToFile(
      state.context?.featurePath,
      state._httpJobId,
      capturedUsage,
      {
        taskId: state.currentTask?.id || 'explain-1',
        taskName: state.currentTask?.name || 'Explain',
        node: 'docGen-explain',
        callIndex: state._docGenCallIndex || 0,
        nodeHistoryLength: priorTurns.length,
        estimatedPromptChars: systemPrompt.length + (state.directive?.length || 0),
        taskCumulativeInput: state._currentTaskTokenUsage?.inputTokens || 0,
        taskCumulativeOutput: state._currentTaskTokenUsage?.outputTokens || 0,
      },
    );
  }

  const nodeHistory: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }> = priorTurns.length > 0
    ? [...priorTurns as any]
    : [{ role: 'user', content: state.directive || '(no directive provided)' }];
  nodeHistory.push(buildAssistantMessage({ text: textResponse || undefined }));

  console.log(`💬 [DocGen/Explain] chat-only response complete (${textResponse.length} chars)`);

  return {
    files: [],
    conversations: { [CONV_KEYS.NODE_DOCGEN]: nodeHistory },
    _docGenCallIndex: (state._docGenCallIndex || 0) + 1,
    _noOutputCallCount: 0,
    _pendingDoneCheck: false,
    _doneCheckEscalation: 0,
    _activePhase: 'docGen' as const,
    _currentTaskTokenUsage: state._currentTaskTokenUsage,
    tokenUsage: state.tokenUsage,
    llmResponse: {
      textResponse,
      done: true,
    },
  };
}
