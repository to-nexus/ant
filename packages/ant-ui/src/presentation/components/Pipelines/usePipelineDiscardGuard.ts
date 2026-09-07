import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { selectPipelineDirty } from '@/domain/store/slices/pipelineSlice';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

/**
 * The ONE owner of the "discard unsaved changes?" confirm. Runs `action` at
 * once when nothing is dirty; otherwise confirms, discards all three drafts,
 * then runs it. Wiring ⇄ Execution needs no guard — the drafts live in the
 * store and the ChangedBar shows on both views.
 */
export function usePipelineDiscardGuard(): (action: () => void) => void {
  const { t } = useTranslation('pipelines');
  const { showConfirm } = useAlertModalContext();
  const discardPipelineAll = useStore((s) => s.discardPipelineAll);
  return useCallback(
    (action: () => void) => {
      if (!selectPipelineDirty(useStore.getState())) {
        action();
        return;
      }
      showConfirm(t('rail.discardConfirm', 'Discard unsaved changes?'), {
        onConfirm: () => {
          discardPipelineAll();
          action();
        },
      });
    },
    [showConfirm, t, discardPipelineAll],
  );
}
