import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';

/**
 * When artifact mutations (create/upload/delete/rename/save) are blocked by
 * {@link useUIActionPolicy}, shows a single warning modal with a clear reason
 * (sign-in, disconnected, stopping, running, or missing selection).
 *
 * @returns `true` if the caller should abort the mutation (modal was shown).
 */
export function useNotifyArtifactMutationBlocked(): () => boolean {
  const policy = useUIActionPolicy();
  const { showWarning } = useAlertModalContext();
  const { t } = useTranslation('artifacts');
  const backendMode = useStore((s) => s.backendMode);
  const userEmail = useStore((s) => s.userEmail);
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);

  return useCallback((): boolean => {
    if (policy.canCreateFile) return false;

    const title = t('error.artifactBlockedTitle');

    if (backendMode === 'cloud' && !userEmail) {
      showWarning(t('error.artifactBlockedSignIn'), { title, type: 'warning' });
      return true;
    }
    if (policy.isDisconnected) {
      showWarning(t('error.artifactBlockedDisconnected'), { title, type: 'warning' });
      return true;
    }
    if (policy.isStopping) {
      showWarning(t('error.artifactBlockedStopping'), { title, type: 'warning' });
      return true;
    }
    if (policy.isRunning) {
      showWarning(t('error.artifactBlockedRunning'), { title, type: 'warning' });
      return true;
    }
    if (!selectedProject || !selectedFeature) {
      showWarning(t('error.artifactBlockedSelectContext'), { title, type: 'warning' });
      return true;
    }

    showWarning(t('error.artifactBlockedGeneric'), { title, type: 'warning' });
    return true;
  }, [
    policy.canCreateFile,
    policy.isDisconnected,
    policy.isStopping,
    policy.isRunning,
    showWarning,
    t,
    backendMode,
    userEmail,
    selectedProject,
    selectedFeature,
  ]);
}
