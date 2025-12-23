import { RefreshCw } from 'lucide-react';
import { Button } from '../../common/button';
import { useStore } from '@/domain/store';

interface LoadingButtonProps {
  isFetchingChanges: boolean;
}

export function LoadingButton({ isFetchingChanges }: LoadingButtonProps) {
  const { isGitStatusLoading, gitStatusPhase } = useStore();
  
  let loadingMessage = 'Updating...';
  
  // ✅ Unified phase-based messages
  if (gitStatusPhase === 'fetching') {
    loadingMessage = 'Fetching...';
  } else if (gitStatusPhase === 'pushing') {
    loadingMessage = 'Pushing...';
  } else if (gitStatusPhase === 'pulling') {
    loadingMessage = 'Pulling...';
  } else if (gitStatusPhase === 'committing') {
    loadingMessage = 'Committing...';
  } else if (gitStatusPhase === 'syncing') {
    loadingMessage = 'Syncing...';
  } else if (gitStatusPhase === 'switching') {
    loadingMessage = 'Switching...';
  } else if (gitStatusPhase === 'initializing') {
    loadingMessage = 'Initializing...';
  } else if (gitStatusPhase === 'cloning') {
    loadingMessage = 'Cloning...';
  } else if (isFetchingChanges && !isGitStatusLoading) {
    loadingMessage = 'Checking...';
  }
  
  return (
    <div className="flex items-center flex-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                   opacity-50 cursor-default
                   text-gray-600 dark:text-gray-400
                   border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-800/50"
      >
        <RefreshCw className="w-3 h-3 animate-spin" />
        {loadingMessage}
      </Button>
    </div>
  );
}
