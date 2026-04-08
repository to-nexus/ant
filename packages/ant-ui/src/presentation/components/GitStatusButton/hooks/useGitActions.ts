import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  commitGitChanges, 
  pushToGitHub, 
  pullFromGitHub, 
  syncWithRemote,
  discardGitChanges,
  initializeGitHubRepo
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { GitChanges } from './useGitChanges';

export function useGitActions(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  gitChanges: GitChanges | null
) {
  const setGitStatusPhase = useStore((state) => state.setGitStatusPhase);
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

  const doInitializeAndPush = async () => {
    setIsPushing(true);
    setGitStatusPhase('initializing');
    try {
      const result = await initializeGitHubRepo(selectedProject!, selectedFeature);
      if (result.success) {
        toast.success(t('git.repoInitialized'));
        useStore.getState().refreshGitStatus();
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

  const handlePush = async () => {
    if (!selectedProject) return;

    const hasRemote = !!useStore.getState().gitStatus?.remoteUrl;

    if (!hasRemote) {
      showConfirm(t('config:git.confirmPublish'), {
        title: t('config:git.publish'),
        type: 'info',
        confirmText: t('config:git.publish'),
        onConfirm: doInitializeAndPush,
      });
      return;
    }

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
    handlePull,
    handleSync,
    handleDiscard
  };
}
