import { useState } from 'react';
import { 
  commitGitChanges, 
  pushToGitHub, 
  pullFromGitHub, 
  syncWithRemote,
  getGitChanges 
} from '@/infrastructure/http/api';
import { GitChanges } from './useGitChanges';

export function useGitActions(
  selectedProject: string | undefined,
  gitChanges: GitChanges | null,
  setGitChanges: (changes: GitChanges | null) => void
) {
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleCommit = async () => {
    if (!selectedProject || !gitChanges) return;

    setIsCommitting(true);
    try {
      const result = await commitGitChanges(selectedProject);
      if (result.success) {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[useGitActions] Commit failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Commit error:', error.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!selectedProject) return;

    setIsPushing(true);
    try {
      const result = await pushToGitHub(selectedProject);
      if (result.success) {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[useGitActions] Push failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Push error:', error.message);
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!selectedProject) return;

    setIsPulling(true);
    try {
      const result = await pullFromGitHub(selectedProject);
      if (result.success) {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[useGitActions] Pull failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Pull error:', error.message);
    } finally {
      setIsPulling(false);
    }
  };

  const handleSync = async () => {
    if (!selectedProject) return;

    setIsSyncing(true);
    try {
      const result = await syncWithRemote(selectedProject);
      if (result.success) {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[useGitActions] Sync failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Sync error:', error.message);
    } finally {
      setIsSyncing(false);
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
