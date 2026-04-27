import { useStore } from '@/domain/store';
import { selectPausedNonTaskJob } from '@/domain/store/selectors';
import { API_BASE, addChatUserMessage, resolveChoice } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';
import { deriveFromIntent } from '@ant/shared';
import type { ChatLine, ChatChoicePresentedLine, ChatChoiceResolvedLine } from '@ant/shared';

interface UseChatSubmitOptions {
  message: string;
  setMessage: (msg: string) => void;
  showError: (msg: string, opts?: { title?: string }) => void;
}

/**
 * Encapsulates the full chat submit pipeline: clarify answer merging,
 * inline-ask branching for interrupted jobs, and normal job execution.
 */
export function useChatSubmit({ message, setMessage, showError }: UseChatSubmitOptions) {
  const { t } = useTranslation('chat');
  const selectedJobType = useStore((state) => state.selectedJobType);
  const selectedAgent = useStore((state) => state.selectedAgent);

  const handleSubmit = async () => {
    const hasPendingClarifyNow = Object.keys(useStore.getState().pendingClarifyAnswers).length > 0;
    if (!message.trim() && !hasPendingClarifyNow) return;

    const selectedProject = useStore.getState().selectedProject;
    const selectedFeature = useStore.getState().selectedFeature;
    const kanbanData = useStore.getState().kanban;

    if (!selectedProject || !selectedFeature || !selectedAgent || !selectedJobType) {
      console.error('[ChatInput] Missing required selection for job execution');
      return;
    }

    // Combine pending clarify answers with free text
    const pendingAnswers = useStore.getState().pendingClarifyAnswers;
    const pendingQuestions = useStore.getState().pendingClarifyQuestions;
    const hasPendingClarify = Object.keys(pendingAnswers).length > 0;

    let userMessage = '';
    if (hasPendingClarify) {
      const structured = Object.entries(pendingAnswers)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([idx, answer]) => `- ${pendingQuestions[Number(idx)] || `Q${Number(idx) + 1}`}: ${answer}`)
        .join('\n');
      userMessage += structured;
      if (message.trim()) {
        userMessage += '\n\n' + message.trim();
      }
      useStore.getState().clearPendingClarify();
    } else {
      userMessage = message;

      if (pendingQuestions.length > 0) {
        // Phase 12 chat-SSOT — find the unresolved clarifying card from
        // the durable event stream (chat.jsonl mirror) and resolve it
        // through the unified `/chat/choice-resolved` endpoint. The SSE
        // `choice_resolved` line that follows folds the card into its
        // resolved state via the FE projector.
        //
        // `collapsed` lines are excluded — the chat-log collapse path
        // (chat sweep / hard reset) marks them as disk-only and the
        // projector hides them; resolving a collapsed card by mistake
        // would mint an orphan choice_resolved.
        const events = (useStore.getState().chatEvents ?? []) as ChatLine[];
        const live = events.filter((e) => !e.collapsed);
        const resolvedIds = new Set<string>();
        for (const e of live) {
          if (e.type === 'choice_resolved') resolvedIds.add((e as ChatChoiceResolvedLine).cardId);
        }
        const unresolvedClarifying = [...live].reverse().find(
          (e): e is ChatChoicePresentedLine =>
            e.type === 'choice_presented' &&
            (e as ChatChoicePresentedLine).cardType === 'clarifying' &&
            !resolvedIds.has((e as ChatChoicePresentedLine).cardId),
        );
        if (unresolvedClarifying) {
          try {
            await resolveChoice(selectedProject, selectedFeature, {
              cardId: unresolvedClarifying.cardId,
              choiceSelected: 'skipped',
              resolvedLabel: t('clarify.allSkipped'),
              answer: { resolvedAnswers: {} },
            });
          } catch (error) {
            console.warn('[ChatInput] Failed to skip clarifying card:', error);
          }
        }
        useStore.getState().clearPendingClarify();
      }
    }

    setMessage('');

    // Check for interrupted job
    const currentJobId = kanbanData?.jobId;
    const dismissedTimestamp = useStore.getState().dismissedInterruptTimestamp;
    const interruptionWasDismissed = kanbanData?.interruption?.timestamp === dismissedTimestamp;
    const hasInterruption = kanbanData?.interruption &&
      !kanbanData?.interruption?.message?.includes('completed') &&
      !interruptionWasDismissed;

    // CASE 1: Interrupted job — inline-ask to classify intent
    if (currentJobId && hasInterruption) {
      try {
        await addChatUserMessage(selectedProject, selectedFeature, userMessage);
        useStore.getState().setRunning(true, currentJobId);
        useStore.getState().setInlineAskContext({
          interruptedJobId: currentJobId,
          projectId: selectedProject,
          featureName: selectedFeature,
          message: userMessage,
        });
        const { inlineAsk } = await import('@/infrastructure/http/api');
        await inlineAsk(selectedProject, selectedFeature, userMessage, true);
      } catch (error) {
        console.error('[ChatInput] Failed to start inline ask:', error);
        useStore.getState().setRunning(false);
        useStore.getState().setInlineAskContext(null);
        showError(
          `${t('inlineAsk.failed')}: ${error instanceof Error ? error.message : t('common:error.unknown')}`,
          { title: t('common:error.title') }
        );
      }
      return;
    }

    // CASE 2: Normal path — start new job
    useStore.getState().setRunning(true, undefined, 'generate');

    const storeActionMetadata = useStore.getState().actionMetadata;
    const hasMetadata = storeActionMetadata && Object.keys(storeActionMetadata).length > 0;

    // Invariant I1 — paused non-task job (plan / visual on a clarify
    // card) overrides every other jobType/agent source. The store's
    // selectedJobType + actionMetadata.intent may have drifted to 'code'
    // since the card was issued (zonal-dreaming-novel regression).
    const pausedNonTask = selectPausedNonTaskJob(useStore.getState());

    try {
      const { turnId } = await addChatUserMessage(
        selectedProject,
        selectedFeature,
        userMessage,
        hasMetadata ? storeActionMetadata : undefined,
      );

      const { executeCodeJob } = await import('@/infrastructure/http/cli');

      const derived = hasMetadata && storeActionMetadata.intent
        ? deriveFromIntent(storeActionMetadata.intent)
        : null;
      const resolvedAgent = pausedNonTask?.agent ?? derived?.agent ?? selectedAgent;
      const resolvedJobType = pausedNonTask?.jobType ?? derived?.jobType ?? selectedJobType;

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: resolvedJobType,
        agent: resolvedAgent,
        overrideDirective: userMessage,
        chatSource: true,
        actionMetadata: hasMetadata ? storeActionMetadata : undefined,
        // chat SSOT §6 — forward the API-allocated turnId so the worker
        // reuses it for the durable user_turn line; eliminates the
        // optimistic-vs-durable id mismatch that produced two user
        // messages on tab-switch / reconnect.
        seedTurnId: turnId,
      });

      if (hasMetadata) {
        useStore.getState().resetActionMetadata();
      }

      useStore.getState().setCurrentJob(jobExecution);

      jobExecution.onJobIdReady(async (jobId) => {
        useStore.getState().setRunning(true, jobId);
      });

      jobExecution.on('exit', async (code, signal) => {
        const jobFailed = code !== 0 && code !== null;
        useStore.getState().setLastJobFailed(jobFailed);
        useStore.getState().setRunning(false);

        if (jobFailed) {
          try {
            const jobId = useStore.getState().currentJobId;
            if (jobId) {
              await fetch(
                `${API_BASE()}/projects/${selectedProject}/features/${selectedFeature}/chat/job-error`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jobId,
                    errorMessage: signal
                      ? `Job was terminated with signal: ${signal}`
                      : `Job failed with exit code: ${code}`,
                    errorDetails: { code, signal }
                  })
                }
              );
            }
          } catch (error) {
            console.error('[ChatInput] Failed to add error message:', error);
          }
        }
      });

    } catch (error) {
      console.error('[ChatInput] Failed to start job:', error);
      useStore.getState().setRunning(false);
      setMessage(userMessage);
      // Phase 12 chat-SSOT — addChatUserMessage / executeCodeJob client
      // failures never reach the BE chat stream, so a toast keeps the
      // user informed instead of letting the failure go silent. BE-side
      // /execute failures emit `assistant_message` lines via chatService.
      const detail = error instanceof Error ? error.message : t('common:error.unknown');
      showError(`${t('inlineAsk.failed', { defaultValue: 'Job failed to start' })}: ${detail}`, {
        title: t('common:error.title'),
      });
    }
  };

  return { handleSubmit };
}
