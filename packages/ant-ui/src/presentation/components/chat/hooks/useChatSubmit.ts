import { useStore } from '@/domain/store';
import { API_BASE, addChatUserMessage } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';

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
        const messages = useStore.getState().chatMessages;
        for (const msg of messages) {
          const clarifyIdx = msg.contents.findIndex(
            (c: any) => c && c.type === 'choice_card' && c.metadata?.cardType === 'clarifying' && !c.metadata?.choiceSelected
          );
          if (clarifyIdx !== -1) {
            const updatedContents = [...msg.contents];
            const resolvedAnswers: Record<number, string> = {};
            updatedContents[clarifyIdx] = {
              ...updatedContents[clarifyIdx],
              metadata: {
                ...updatedContents[clarifyIdx].metadata,
                choiceSelected: 'skipped',
                resolvedLabel: t('clarify.allSkipped'),
                resolvedAnswers,
              },
            };
            useStore.getState().updateChatMessage(msg.id, { contents: updatedContents });
            break;
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

    try {
      await addChatUserMessage(selectedProject, selectedFeature, userMessage);

      const { executeCodeJob } = await import('@/infrastructure/http/cli');

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: selectedJobType,
        agent: selectedAgent,
        overrideDirective: userMessage,
        chatSource: true
      });

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
    }
  };

  return { handleSubmit };
}
