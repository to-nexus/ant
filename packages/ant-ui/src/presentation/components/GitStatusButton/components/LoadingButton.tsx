import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../common/button';
import { useStore } from '@/domain/store';

interface LoadingButtonProps {
  isFetchingChanges: boolean;
}

export function LoadingButton({ isFetchingChanges }: LoadingButtonProps) {
  const { t } = useTranslation('explorer');
  const { isGitStatusLoading, gitStatusPhase } = useStore();
  
  let loadingMessage = t('git.updating');
  
  // ✅ Unified phase-based messages
  if (gitStatusPhase === 'fetching') {
    loadingMessage = t('git.fetching');
  } else if (gitStatusPhase === 'pushing') {
    loadingMessage = t('git.pushing');
  } else if (gitStatusPhase === 'pulling') {
    loadingMessage = t('git.pulling');
  } else if (gitStatusPhase === 'committing') {
    loadingMessage = t('git.committing');
  } else if (gitStatusPhase === 'syncing') {
    loadingMessage = t('git.syncing');
  } else if (gitStatusPhase === 'switching') {
    loadingMessage = t('git.switching');
  } else if (gitStatusPhase === 'initializing') {
    loadingMessage = t('git.initializing');
  } else if (gitStatusPhase === 'cloning') {
    loadingMessage = t('git.cloning');
  } else if (gitStatusPhase === 'discarding') {
    loadingMessage = t('git.discarding');
  } else if (isFetchingChanges && !isGitStatusLoading) {
    loadingMessage = t('git.checking');
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
