import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  useGitDispatch,
  type GitUserOperation,
  type GitOperationError,
} from '@/domain/git-world';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';

/**
 * Action handlers for the secondary Git control button — the dropdown
 * carrying Clone / Initialize / Publish / Push / Pull / Fetch.
 *
 * Every handler funnels through `runGitOperation` (the same FSM used by
 * GitStatusButton) so the two buttons always agree on in-flight state
 * by construction. PAT-class failures surface the "Configure PAT"
 * affordance routed to AccountConfig; all other errors fall back to
 * `showError(error.message)`.
 */
interface MenuActions {
  handleClone: () => void;
  handleInitialize: () => void;
  handlePublish: () => void;
  handlePush: () => void;
  handlePull: () => void;
  handleFetch: () => void;
}

export function useGitMenuActions(options: { onClose: () => void }): MenuActions {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const { runGitOperation } = useGitDispatch();
  const { showError, showConfirm } = useAlertModalContext();
  const { toast } = useToastContext();

  const { onClose } = options;

  const showPATError = useCallback(() => {
    showError(t('git.patNotConfigured'), {
      confirmText: t('git.configurePat'),
      onConfirm: () => openMainPanelTab('accountConfig'),
    });
  }, [showError, openMainPanelTab, t]);

  const runMenuOp = useCallback(
    async (
      gitOp: GitUserOperation,
      opts: {
        successToast?: string;
        reloadIde?: boolean;
        failureFallback: string;
      },
    ) => {
      if (!selectedProject) return;
      onClose();
      const result = await runGitOperation(selectedProject, gitOp);
      if (result.success) {
        if (opts.successToast) toast.success(opts.successToast);
        if (opts.reloadIde) useStore.getState().reloadIdeFrame();
        return;
      }
      const err: GitOperationError | undefined = result.error;
      if (err?.kind === 'auth' || err?.suggestedAction === 'configurePat') {
        showPATError();
        return;
      }
      showError(err?.message || opts.failureFallback);
    },
    [selectedProject, runGitOperation, showError, showPATError, toast, onClose],
  );

  const handleClone = useCallback(() => {
    if (!selectedProject) return;
    onClose();
    showConfirm(t('config:git.confirmClone'), {
      title: t('config:git.clone'),
      type: 'info',
      confirmText: t('config:git.clone'),
      onConfirm: () => {
        void runMenuOp(
          { kind: 'clone' },
          {
            successToast: t('git.repoCloned'),
            reloadIde: true,
            failureFallback: t('git.actionFailed', { action: 'clone' }),
          },
        );
      },
    });
  }, [selectedProject, onClose, showConfirm, runMenuOp, t]);

  const handleInitialize = useCallback(() => {
    if (!selectedProject) return;
    onClose();
    showConfirm(t('config:git.confirmInit'), {
      title: t('config:git.initialize'),
      type: 'info',
      confirmText: t('config:git.initialize'),
      onConfirm: () => {
        void runMenuOp(
          { kind: 'publish', feature: selectedFeature || undefined },
          {
            successToast: t('git.repoInitialized'),
            reloadIde: true,
            failureFallback: t('git.actionFailed', { action: 'init' }),
          },
        );
      },
    });
  }, [selectedProject, selectedFeature, onClose, showConfirm, runMenuOp, t]);

  const handlePublish = useCallback(() => {
    if (!selectedProject) return;
    onClose();
    showConfirm(t('config:git.confirmPublish'), {
      title: t('config:git.publish'),
      type: 'info',
      confirmText: t('config:git.publish'),
      onConfirm: () => {
        void runMenuOp(
          { kind: 'publish', feature: selectedFeature || undefined },
          {
            successToast: t('git.repoInitialized'),
            reloadIde: true,
            failureFallback: t('git.actionFailed', { action: 'init' }),
          },
        );
      },
    });
  }, [selectedProject, selectedFeature, onClose, showConfirm, runMenuOp, t]);

  const handlePush = useCallback(() => {
    void runMenuOp(
      { kind: 'push', feature: selectedFeature || undefined },
      {
        successToast: t('git.pushSuccess'),
        failureFallback: t('git.actionFailed', { action: 'push' }),
      },
    );
  }, [selectedFeature, runMenuOp, t]);

  const handlePull = useCallback(() => {
    void runMenuOp(
      { kind: 'pull', feature: selectedFeature || undefined },
      {
        successToast: t('git.pullSuccess'),
        failureFallback: t('git.actionFailed', { action: 'pull' }),
      },
    );
  }, [selectedFeature, runMenuOp, t]);

  const handleFetch = useCallback(() => {
    void runMenuOp(
      { kind: 'fetch', feature: selectedFeature || undefined },
      {
        successToast: t('git.fetchSuccess'),
        failureFallback: t('git.actionFailed', { action: 'fetch' }),
      },
    );
  }, [selectedFeature, runMenuOp, t]);

  return {
    handleClone,
    handleInitialize,
    handlePublish,
    handlePush,
    handlePull,
    handleFetch,
  };
}
