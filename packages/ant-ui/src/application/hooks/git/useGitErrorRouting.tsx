import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitUserOperation } from '@ant/shared';
import { useStore } from '@/domain/store';
import { useGitDispatch } from '@/domain/git-world';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { GitErrorDetails } from '@/presentation/components/GitErrorDetails';
import type { GitOperationError } from '@/domain/git-world';

/**
 * Centralised Git error presentation — single source of truth.
 *
 * Every dispatch site funnels its failure here, and the hook is TOTAL: it
 * always presents a dialog that names the cause and the next step. The two
 * things it must never do are show the raw git stderr as the primary text,
 * or hand the caller an unhandled error to print itself — that split is how
 * `! [rejected] (fetch first)` ended up in a user-facing modal.
 *
 * The raw output survives as the collapsed detail of the unknown fallback.
 *
 * `fallback: 'none'` is for the ONE surface that owns its own error UI:
 * the project wizard renders per-step errors plus a skip/retry/abort
 * decision dialog, so a modal on top would stack two dialogs. It still gets
 * the classified branches (PAT etc.) where a dialog IS the right recovery.
 */

export interface GitErrorRoutingOptions {
  /** The operation that failed — titles the dialog and is the retry target. */
  op?: GitUserOperation;
  /** `'modal'` (default) presents everything; `'none'` leaves the residue to the caller. */
  fallback?: 'modal' | 'none';
}

export function useGitErrorRouting(): (
  err: GitOperationError | undefined,
  options?: GitErrorRoutingOptions,
) => { handled: boolean } {
  const { t } = useTranslation('explorer');
  const { showError, showConfirm } = useAlertModalContext();
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const { runGitOperation, selectedProject } = useGitDispatch();

  return useCallback(
    (err: GitOperationError | undefined, options?: GitErrorRoutingOptions) => {
      const op = options?.op;
      const feature = op && 'feature' in op ? op.feature : undefined;
      const params = (err?.params ?? {}) as Record<string, string | number>;

      // Recovery dispatch. The FSM is `failed` by the time we run, so the
      // single-flight guard in `runGitOperation` never rejects these.
      const dispatch = (next: GitUserOperation) => {
        if (!selectedProject) return;
        void runGitOperation(selectedProject, next);
      };

      if (err?.kind === 'auth' || err?.suggestedAction === 'configurePat') {
        showError(t('git.patNotConfigured'), {
          confirmText: t('git.configurePat'),
          onConfirm: () => openMainPanelTab('accountConfig'),
        });
        return { handled: true };
      }

      // The remote moved while this workspace was not looking. Sync (fetch →
      // pull → push) is the whole recovery, so offer it directly.
      if (err?.suggestedAction === 'syncFirst') {
        showConfirm(
          t('git.remoteAheadSyncFirst', {
            branch: params.branch ?? '',
            count: params.count ?? 0,
          }),
          {
            title: t('git.remoteAheadTitle'),
            type: 'warning',
            confirmText: t('git.sync'),
            onConfirm: () => dispatch({ kind: 'sync', feature, strategy: 'merge' }),
          },
        );
        return { handled: true };
      }

      if (err?.suggestedAction === 'commitFirst') {
        showError(t('git.commitBeforePull'), { title: t('git.commitBeforePullTitle') });
        return { handled: true };
      }

      // The rebase was rolled back server-side, so the worktree is intact and
      // merge is a legitimate one-click alternative.
      if (err?.suggestedAction === 'retryWithMerge') {
        showConfirm(t('git.rebaseAborted'), {
          title: t('git.rebaseAbortedTitle'),
          type: 'warning',
          confirmText: t('git.pullWithMerge'),
          onConfirm: () => dispatch({ kind: 'pull', feature, strategy: 'merge' }),
        });
        return { handled: true };
      }

      if (err?.suggestedAction === 'resolveConflict') {
        showError(t('git.conflictResolveInIde'), { title: t('git.conflictTitle') });
        return { handled: true };
      }

      if (err?.suggestedAction === 'runClone') {
        showConfirm(t('git.cloneNeeded'), {
          title: t('git.cloneNeededTitle'),
          type: 'info',
          confirmText: t('config:git.clone'),
          onConfirm: () => dispatch({ kind: 'clone' }),
        });
        return { handled: true };
      }

      if (
        err?.suggestedAction === 'reconfigureRepo' ||
        err?.kind === 'notFound' ||
        err?.kind === 'config'
      ) {
        showError(
          <GitErrorDetails
            summary={t('git.repoConfigProblem')}
            detailLabel={t('git.errorDetails')}
            raw={err?.message}
          />,
          {
            title: t('git.repoConfigProblemTitle'),
            confirmText: t('git.openProjectConfig'),
            onConfirm: () => openMainPanelTab('projectConfig'),
          },
        );
        return { handled: true };
      }

      // Lock contention from a concurrent publish/clone/fetch — surface the
      // remaining TTL when the server provided one so the user knows how
      // long to wait, otherwise fall back to a static notice.
      if (err?.kind === 'conflict' && err.retryable) {
        const seconds = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : null;
        showError(
          seconds
            ? t('git.operationInProgressWithCountdown', { seconds })
            : t('git.operationInProgress'),
        );
        return { handled: true };
      }

      if (options?.fallback === 'none') {
        return { handled: false };
      }

      // Transport failure and the client-side timeout both land here; the
      // only sensible affordance is running the same operation again.
      if (err?.kind === 'network') {
        showConfirm(
          <GitErrorDetails
            summary={t('git.networkProblem')}
            detailLabel={t('git.errorDetails')}
            raw={err?.message}
          />,
          {
            title: t('git.networkProblemTitle'),
            type: 'warning',
            confirmText: t('git.retry'),
            onConfirm: () => { if (op) dispatch(op); },
          },
        );
        return { handled: true };
      }

      showError(
        <GitErrorDetails
          summary={t('git.unknownFailure')}
          detailLabel={t('git.errorDetails')}
          raw={err?.message}
        />,
        { title: t('git.actionFailed', { action: op?.kind ?? 'git' }) },
      );
      return { handled: true };
    },
    [showError, showConfirm, openMainPanelTab, runGitOperation, selectedProject, t],
  );
}
