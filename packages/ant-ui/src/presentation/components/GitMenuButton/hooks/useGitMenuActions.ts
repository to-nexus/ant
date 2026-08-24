import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitCloneResult, GitInitResult } from '@ant/shared';
import { useStore } from '@/domain/store';
import {
  useGitDispatch,
  useGitSnapshot,
  type GitUserOperation,
} from '@/domain/git-world';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { useGitErrorRouting } from '@/application/hooks/git/useGitErrorRouting';

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
  const { runGitOperation } = useGitDispatch();
  const snapshot = useGitSnapshot();
  const { showError, showConfirm } = useAlertModalContext();
  const { toast } = useToastContext();
  const handleGitError = useGitErrorRouting();

  const { onClose } = options;

  const runMenuOp = useCallback(
    async (
      gitOp: GitUserOperation,
      opts: {
        successToast?: string;
        reloadIde?: boolean;
        failureFallback: string;
      },
    ): Promise<{ success: boolean; result?: unknown }> => {
      if (!selectedProject) return { success: false };
      onClose();
      const result = await runGitOperation(selectedProject, gitOp);
      if (result.success) {
        if (opts.successToast) toast.success(opts.successToast);
        if (opts.reloadIde) void useStore.getState().bumpIdeReloadTimestamp();
        return { success: true, result: result.result };
      }
      const { handled } = handleGitError(result.error);
      if (!handled) showError(result.error?.message || opts.failureFallback);
      return { success: false };
    },
    [selectedProject, runGitOperation, showError, handleGitError, toast, onClose],
  );

  /**
   * Select a feature the BE auto-created during the operation (clone's
   * remote-HEAD feature, or init's base-branch feature). Without this the
   * user lands on the "Create a feature to start" placeholder right after a
   * successful op. `preferred` absent → fall back to the sole listed feature
   * (both auto-create paths require zero features beforehand).
   */
  const adoptCreatedFeature = useCallback(async (projectId: string, preferred?: string) => {
    const store = useStore.getState();
    await store.fetchFeatures(projectId);
    const adopted = preferred ?? useStore.getState().features[0]?.name;
    if (adopted) store.setSelectedFeature(adopted);
  }, []);

  const handleClone = useCallback(() => {
    if (!selectedProject) return;
    onClose();
    // Defensive mirror of the BE hard guard — clone requires zero features.
    if (snapshot?.hasFeatures) {
      showError(t('config:git.cloneBlockedNotice'));
      return;
    }
    showConfirm(t('config:git.confirmClone'), {
      title: t('config:git.clone'),
      type: 'info',
      confirmText: t('config:git.clone'),
      onConfirm: () => {
        void (async () => {
          const projectId = selectedProject;
          const outcome = await runMenuOp(
            { kind: 'clone' },
            {
              successToast: t('git.repoCloned'),
              reloadIde: true,
              failureFallback: t('git.actionFailed', { action: 'clone' }),
            },
          );
          if (!outcome.success) return;
          // Adopt the auto-created base feature (named after the remote
          // default branch) so the user immediately sees the cloned code.
          const cloneResult = outcome.result as Partial<GitCloneResult> | undefined;
          await adoptCreatedFeature(projectId, cloneResult?.feature);
        })();
      },
    });
  }, [selectedProject, snapshot, onClose, showConfirm, showError, runMenuOp, adoptCreatedFeature, t]);

  /**
   * Initialize / Publish share one BE op (`publish`) and differ only in copy.
   * On the init variant the BE may have materialized the base-branch feature
   * (featureless project) — adopt it so the user isn't left on the
   * "Create a feature to start" placeholder.
   */
  const confirmAndPublish = useCallback(
    (copy: { confirm: string; title: string }) => {
      if (!selectedProject) return;
      onClose();
      showConfirm(copy.confirm, {
        title: copy.title,
        type: 'info',
        confirmText: copy.title,
        onConfirm: () => {
          void (async () => {
            const projectId = selectedProject;
            const outcome = await runMenuOp(
              { kind: 'publish', feature: selectedFeature || undefined },
              {
                successToast: t('git.repoInitialized'),
                reloadIde: true,
                failureFallback: t('git.actionFailed', { action: 'init' }),
              },
            );
            if (!outcome.success) return;
            const initResult = outcome.result as Partial<GitInitResult> | undefined;
            if (initResult?.feature) {
              await adoptCreatedFeature(projectId, initResult.feature);
            }
          })();
        },
      });
    },
    [selectedProject, selectedFeature, onClose, showConfirm, runMenuOp, adoptCreatedFeature, t],
  );

  const handleInitialize = useCallback(() => {
    confirmAndPublish({ confirm: t('config:git.confirmInit'), title: t('config:git.initialize') });
  }, [confirmAndPublish, t]);

  const handlePublish = useCallback(() => {
    confirmAndPublish({ confirm: t('config:git.confirmPublish'), title: t('config:git.publish') });
  }, [confirmAndPublish, t]);

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
