import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitSnapshot } from '@ant/shared';
import {
  useGitDispatch,
  useGitOperation,
} from '@/domain/git-world';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { useGitErrorRouting } from '@/application/hooks/git/useGitErrorRouting';

/**
 * Git operation handlers bound to the currently selected (project, feature).
 *
 * Every handler funnels through `runGitOperation` which owns the single
 * FSM (`GitOperationState`) — the returned booleans (`isCommitting`, …)
 * are derived from that FSM so we never carry a parallel loading flag.
 * Snapshot refresh is published by the BE `GitOperation.onSuccess` hook
 * as a `gitState` SSE event (cause='operationComplete'); callers must
 * not re-fetch manually.
 *
 * The destructive discard + publish flows prompt via `showConfirm` for
 * parity with the pre-greenfield UX. Everything else dispatches directly.
 */
export function useGitActions(
  selectedProject: string | null | undefined,
  selectedFeature: string | null | undefined,
  snapshot: GitSnapshot | null,
) {
  const { t } = useTranslation('explorer');
  const op = useGitOperation();
  const { runGitOperation, fetchGitWorldState } = useGitDispatch();
  const { showConfirm } = useAlertModalContext();
  const { toast } = useToastContext();
  const handleGitError = useGitErrorRouting();

  // Running flags derived from the FSM. Discriminant union ensures only
  // one is true at a time.
  const running = op.status === 'running' ? op.op.kind : null;
  const isCommitting = running === 'commit';
  // Both `push` and `publish` mutate the remote ref — the UI treats them
  // as one "pushing" state from the user's perspective.
  const isPushing = running === 'push' || running === 'publish';
  const isPulling = running === 'pull';
  const isSyncing = running === 'sync';
  const isDiscarding = running === 'discard';

  const featureArg = selectedFeature ?? undefined;

  // Commit decision modal state (E6-1). `handleCommit` opens it; the modal
  // resolves to a user-authored or ant-authored dispatch. The modal holds NO
  // file list — the selection is read live at dispatch time (a list frozen
  // at modal-open goes stale while the user thinks, and a stale path used to
  // abort the whole `git add`).
  const [commitModal, setCommitModal] = useState<{ open: boolean }>({ open: false });

  const handleCommit = useMemo(
    () => () => {
      if (!selectedProject || !snapshot) return;
      setCommitModal({ open: true });
    },
    [selectedProject, snapshot],
  );

  const closeCommitModal = useCallback(() => setCommitModal({ open: false }), []);

  const dispatchCommit = useCallback(
    async (authorMode: 'user' | 'ant', message?: string, files?: string[]) => {
      if (!selectedProject || !snapshot) return;
      setCommitModal({ open: false });
      const result = await runGitOperation(selectedProject, {
        kind: 'commit',
        feature: featureArg,
        files,
        authorMode,
        ...(message ? { message } : {}),
      });
      if (result.success) {
        toast.success(t('git.commitSuccess'));
      } else {
        // Refetch even on failure — the change list may be why we failed
        // (stale paths); leaving it stale would reproduce the same failure
        // on retry. Belt-and-braces with the BE's failure-path broadcast.
        void fetchGitWorldState(selectedProject, { feature: featureArg });
        handleGitError(result.error, {
          op: { kind: 'commit', feature: featureArg, files, authorMode, ...(message ? { message } : {}) },
        });
      }
    },
    [selectedProject, snapshot, featureArg, runGitOperation, fetchGitWorldState, handleGitError, toast, t],
  );

  // Pure push — BE's push-variant of the `publish` operation auto-sets
  // `--set-upstream` when the current branch has no upstream. The CTA
  // selector already picks the correct variant upstream.
  const handlePush = useMemo(
    () => async () => {
      if (!selectedProject) return;
      const result = await runGitOperation(selectedProject, {
        kind: 'push',
        feature: featureArg,
      });
      if (result.success) {
        toast.success(t('git.pushSuccess'));
      } else {
        handleGitError(result.error, { op: { kind: 'push', feature: featureArg } });
      }
    },
    [selectedProject, featureArg, runGitOperation, handleGitError, toast, t],
  );

  // "Publish repository" — remote not yet created. Creates the GitHub repo
  // and pushes the current branch. Always behind a confirm dialog because
  // it has user-visible side effects.
  const handlePublishRepo = useMemo(
    () => () => {
      if (!selectedProject) return;
      showConfirm(t('config:git.confirmPublish'), {
        title: t('config:git.publish'),
        type: 'info',
        confirmText: t('config:git.publish'),
        onConfirm: () => {
          void runGitOperation(selectedProject, {
            kind: 'publish',
            feature: featureArg,
          }).then((result) => {
            if (result.success) {
              toast.success(t('git.repoInitialized'));
            } else {
              handleGitError(result.error, { op: { kind: 'publish', feature: featureArg } });
            }
          });
        },
      });
    },
    [selectedProject, featureArg, runGitOperation, showConfirm, handleGitError, toast, t],
  );

  const handlePull = useMemo(
    () => async () => {
      if (!selectedProject) return;
      const op = { kind: 'pull', feature: featureArg, strategy: 'merge' } as const;
      const result = await runGitOperation(selectedProject, op);
      if (result.success) {
        toast.success(t('git.pullSuccess'));
      } else {
        handleGitError(result.error, { op });
      }
    },
    [selectedProject, featureArg, runGitOperation, handleGitError, toast, t],
  );

  const handleSync = useMemo(
    () => async () => {
      if (!selectedProject) return;
      const op = { kind: 'sync', feature: featureArg, strategy: 'merge' } as const;
      const result = await runGitOperation(selectedProject, op);
      if (result.success) {
        const outcome = result.result as
          | { pulledChanges?: boolean; pushedChanges?: boolean }
          | undefined;
        toast.success(
          outcome?.pulledChanges && outcome?.pushedChanges
            ? t('git.syncSuccessBoth')
            : outcome?.pulledChanges
              ? t('git.syncSuccessPulled')
              : outcome?.pushedChanges
                ? t('git.syncSuccessPushed')
                : t('git.syncSuccessAlreadyUpToDate'),
        );
      } else {
        handleGitError(result.error, { op });
      }
    },
    [selectedProject, featureArg, runGitOperation, handleGitError, toast, t],
  );

  const handleDiscard = useMemo(
    () => (files?: string[]) => {
      if (!selectedProject) return;
      const confirmMsg =
        files && files.length > 0
          ? t('git.confirmDiscardFiles', { count: files.length })
          : t('git.confirmDiscardAll');

      showConfirm(confirmMsg, {
        title: t('git.discard'),
        type: 'warning',
        confirmText: t('git.discard'),
        onConfirm: () => {
          void runGitOperation(selectedProject, {
            kind: 'discard',
            feature: featureArg,
            files,
          }).then((result) => {
            if (result.success) {
              toast.success(t('git.discardSuccess'));
            } else {
              handleGitError(result.error, { op: { kind: 'discard', feature: featureArg, files } });
            }
          });
        },
      });
    },
    [selectedProject, featureArg, runGitOperation, showConfirm, handleGitError, toast, t],
  );

  return {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    isDiscarding,
    handleCommit,
    commitModal,
    closeCommitModal,
    dispatchCommit,
    handlePush,
    handlePublishRepo,
    handlePull,
    handleSync,
    handleDiscard,
  };
}
