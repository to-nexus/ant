import { useState } from 'react';
import { 
  commitGitChanges, 
  pushToGitHub, 
  pullFromGitHub, 
  syncWithRemote
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { GitChanges } from './useGitChanges';

export function useGitActions(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  gitChanges: GitChanges | null,
  setGitChanges: (changes: GitChanges | null) => void
) {
  const setGitStatusPhase = useStore((state) => state.setGitStatusPhase);
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
        console.error('[useGitActions] Commit failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Commit error:', error.message);
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
        console.error('[useGitActions] Push failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Push error:', error.message);
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
        console.error('[useGitActions] Pull failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Pull error:', error.message);
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
        console.error('[useGitActions] Sync failed:', result.error);
      }
    } catch (error: any) {
      console.error('[useGitActions] Sync error:', error.message);
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
