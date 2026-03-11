import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  commitGitChanges, 
  pushToGitHub, 
  pullFromGitHub, 
  syncWithRemote
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { GitChanges } from './useGitChanges';

export function useGitActions(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  gitChanges: GitChanges | null,
  setGitChanges: (changes: GitChanges | null) => void
) {
  const setGitStatusPhase = useStore((state) => state.setGitStatusPhase);
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('explorer');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleCommit = async () => {
    if (!selectedProject || !gitChanges) return;

    setIsCommitting(true);
    setGitStatusPhase('committing');
    
    try {
      const result = await commitGitChanges(selectedProject, undefined, selectedFeature);
      if (result.success) {
        setGitChanges(null);
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

  const handlePush = async () => {
    if (!selectedProject) return;

    setIsPushing(true);
    setGitStatusPhase('pushing');
    
    try {
      const result = await pushToGitHub(selectedProject, selectedFeature);
      if (result.success) {
        setGitChanges(null);
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
        setGitChanges(null);
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
        setGitChanges(null);
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

  return {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    handleCommit,
    handlePush,
    handlePull,
    handleSync
  };
}
