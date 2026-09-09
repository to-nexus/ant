/**
 * useResumeJob — the ONE place a resume click becomes a request, and the one
 * place its refusal becomes something the user can see.
 *
 * Three call sites used to call `resumeJob` directly and each handled failure
 * differently: `useJobExecution` surfaced it, `CancelledVariant` handled only
 * 404 and otherwise wrote to the console, `ResumeConfirmVariant` showed
 * nothing at all. A resume the server refused on purpose therefore looked like
 * a button that did nothing — which is exactly what it was.
 *
 * Rollback stays with the caller: each site holds different optimistic state
 * (a dismissed-interrupt timestamp, a local card choice, `isRunning`), so the
 * hook reports the outcome and the caller restores what it changed.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { resumeJob, ApiError } from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import type { SelectedJobType } from '@/domain/store/types';

/** True when an error is a 402 credit block from a job start/resume. */
function isCreditBlock(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402 && error.code === 'insufficient_credits';
}

export type ResumeOutcome =
  | { ok: true; jobId: string; jobType: SelectedJobType }
  /** The work is genuinely gone (deleted / never archived) — callers degrade. */
  | { ok: false; gone: true; error: unknown }
  | { ok: false; gone: false; error: unknown };

export function useResumeJob() {
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('chat');

  /**
   * @param jobId the interrupted job. The definition ref for a universal job
   *   is NOT passed: the server recovers it from that job's own durable
   *   records, because a client-held ref names the composer's CURRENT
   *   selection rather than the paused pair.
   */
  const resume = useCallback(async (
    jobId: string,
    projectId: string,
    featureName: string,
  ): Promise<ResumeOutcome> => {
    try {
      const result = await resumeJob(jobId, projectId, featureName, true);
      return { ok: true, jobId: result.jobId, jobType: result.jobType };
    } catch (error) {
      console.error('[useResumeJob] resume failed:', error);
      if (isCreditBlock(error)) {
        useStore.getState().setCreditBlockActive?.(true);
        return { ok: false, gone: false, error };
      }
      // A typed refusal names its own reason; anything else falls back to the
      // generic wording rather than showing the user nothing.
      const code = error instanceof ApiError ? error.code : undefined;
      const message = error instanceof Error ? error.message : t('common:error.unknown');
      showError(
        code
          ? t(`resume.errors.${code}`, { defaultValue: t('card.resumeFailed', { message }), message })
          : t('card.resumeFailed', { message }),
      );
      const gone = error instanceof ApiError && error.status === 404;
      return { ok: false, gone, error };
    }
  }, [showError, t]);

  return { resume };
}
