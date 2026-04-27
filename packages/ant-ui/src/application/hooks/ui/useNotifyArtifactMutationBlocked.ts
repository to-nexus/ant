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
 *
 * Opens the warning on the next macrotask so it is not cleared by the same
 * global {@link AlertModal} instance closing after a nested `showConfirm`
 * `onConfirm` (e.g. artifact delete confirm → blocked → must show warning).
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
    let message: string;
    if (backendMode === 'cloud' && !userEmail) {
      message = t('error.artifactBlockedSignIn');
    } else if (policy.isDisconnected) {
      message = t('error.artifactBlockedDisconnected');
    } else if (policy.isStopping) {
      message = t('error.artifactBlockedStopping');
    } else if (policy.isRunning) {
      message = t('error.artifactBlockedRunning');
    } else if (!selectedProject || !selectedFeature) {
      message = t('error.artifactBlockedSelectContext');
    } else {
      message = t('error.artifactBlockedGeneric');
    }

    setTimeout(() => {
      showWarning(message, { title, type: 'warning' });
    }, 0);
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
