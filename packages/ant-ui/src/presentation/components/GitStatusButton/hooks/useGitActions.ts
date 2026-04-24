import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitChangesResponse } from '@ant/shared';
import {
  commitGitChanges,
  pushToGitHub,
  pullFromGitHub,
  syncWithRemote,
  discardGitChanges,
  initializeGitHubRepo
} from '@/infrastructure/http/api';
import { useGitActions as useGitStoreActions } from '@/application/hooks/git';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';

/**
 * Git operation handlers bound to the currently selected feature. Each
 * handler toggles the matching `gitStatusPhase`, runs the REST call, and
 * lets `useGitRefresh` + SSE re-fetch `gitChanges` afterwards.
 *
 * Previously this hook also reached into `useStore.getState().refreshGitStatus`
 * to bump a counter. With the new SSOT we call `fetchGitAll` explicitly on
 * the one handler (`handlePublishRepo`) that mutates remote state.
 */
export function useGitActions(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  gitChanges: GitChangesResponse | null
) {
  const { setGitStatusPhase, fetchGitAll } = useGitStoreActions();
  const { showError, showConfirm } = useAlertModalContext();
  const { toast } = useToastContext();
  const { t } = useTranslation('explorer');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const handleCommit = async (files?: string[]) => {
    if (!selectedProject || !gitChanges) return;

    setIsCommitting(true);
    setGitStatusPhase('committing');

    try {
      const result = await commitGitChanges(selectedProject, undefined, selectedFeature, files);
      if (result.success) {
        toast.success(t('git.commitSuccess'));
      } else {
        showError(result.error || t('git.commitFailed'));
      }
    } catch (error: any) {
      showError(error.message || t('git.commitFailed'));
    } finally {
      setIsCommitting(false);
      setGitStatusPhase(null);
    }
  };

  // Pure push — BE auto-sets `--set-upstream` when the current branch has
  // no upstream. ActionButton/ProjectSection already pick the correct CTA
  // via `deriveGitActionCta` / `deriveGitMenuState`.
  const handlePush = async () => {
    if (!selectedProject) return;

    setIsPushing(true);
    setGitStatusPhase('pushing');

    try {
      const result = await pushToGitHub(selectedProject, selectedFeature);
      if (result.success) {
        toast.success(t('git.pushSuccess'));
      } else {
        showError(result.error || t('git.pushFailed'));
      }
    } catch (error: any) {
      showError(error.message || t('git.pushFailed'));
    } finally {
      setIsPushing(false);
      setGitStatusPhase(null);
    }
  };

  // "Publish repository" — remote not yet created. Creates the GitHub repo
  // and pushes the current branch. Always behind a confirm dialog because
  // it has user-visible side effects.
  const handlePublishRepo = async () => {
    if (!selectedProject) return;
    showConfirm(t('config:git.confirmPublish'), {
      title: t('config:git.publish'),
      type: 'info',
      confirmText: t('config:git.publish'),
      onConfirm: async () => {
        setIsPushing(true);
        setGitStatusPhase('initializing');
        try {
          const result = await initializeGitHubRepo(selectedProject, selectedFeature);
          if (result.success) {
            toast.success(t('git.repoInitialized'));
            // `remoteUrl` / `hasGit` flipped on disk — re-pull both endpoints
            // so the CTA transitions out of the "publish" variant.
            fetchGitAll(selectedProject, selectedFeature);
          } else {
            showError(result.error || t('git.pushFailed'));
          }
        } catch (error: any) {
          showError(error.message || t('git.pushFailed'));
        } finally {
          setIsPushing(false);
          setGitStatusPhase(null);
        }
      },
    });
  };

  const handlePull = async () => {
    if (!selectedProject) return;

    setIsPulling(true);
    setGitStatusPhase('pulling');

    try {
      const result = await pullFromGitHub(selectedProject, selectedFeature);
      if (result.success) {
        toast.success(t('git.pullSuccess'));
      } else {
        showError(result.error || t('git.pullFailed'));
      }
    } catch (error: any) {
      showError(error.message || t('git.pullFailed'));
    } finally {
      setIsPulling(false);
      setGitStatusPhase(null);
    }
  };

  const handleSync = async () => {
    if (!selectedProject) return;

    setIsSyncing(true);
    setGitStatusPhase('syncing');

    try {
      const result = await syncWithRemote(selectedProject, selectedFeature);
      if (result.success) {
        toast.success(t('git.syncSuccess'));
      } else {
        showError(result.error || t('git.syncFailed'));
      }
    } catch (error: any) {
      showError(error.message || t('git.syncFailed'));
    } finally {
      setIsSyncing(false);
      setGitStatusPhase(null);
    }
  };

  const handleDiscard = async (files?: string[]) => {
    if (!selectedProject) return;

    const confirmMsg = files && files.length > 0
      ? t('git.confirmDiscardFiles', { count: files.length })
      : t('git.confirmDiscardAll');

    showConfirm(confirmMsg, {
      title: t('git.discard'),
      type: 'warning',
      confirmText: t('git.discard'),
      onConfirm: async () => {
        setIsDiscarding(true);
        setGitStatusPhase('discarding');
        try {
          const result = await discardGitChanges(selectedProject, selectedFeature, files);
          if (result.success) {
            toast.success(t('git.discardSuccess'));
          } else {
            showError(result.error || t('git.discardFailed'));
          }
        } catch (error: any) {
          showError(error.message || t('git.discardFailed'));
        } finally {
          setIsDiscarding(false);
          setGitStatusPhase(null);
        }
      }
    });
  };

  return {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    isDiscarding,
    handleCommit,
    handlePush,
    handlePublishRepo,
    handlePull,
    handleSync,
    handleDiscard
  };
}
