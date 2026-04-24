/**
 * ConfirmAndDispatch — greenfield replacement for
 * "AlertModal + async onConfirm + local isProcessing state".
 *
 * Key differences vs the legacy pattern:
 * - Single prop `dispatch: () => Promise<unknown>` — no isProcessing
 *   threading through parent components.
 * - Dispatcher runs AFTER the modal closes, with a non-blocking toast-style
 *   banner if the caller provides `renderStatus`. If no `renderStatus` is
 *   given, the component simply fires the dispatch and forgets.
 * - Modal is auto-closed on confirm; retry/error UI is the caller's
 *   responsibility (typically a banner driven by `useOperation`).
 */

import { useCallback } from 'react';
import { AlertModal, type AlertModalProps } from '../../presentation/components/common/AlertModal';

export interface ConfirmAndDispatchProps
  extends Omit<AlertModalProps, 'onConfirm' | 'isOpen' | 'onClose'> {
  /** Controls modal visibility. */
  isOpen: boolean;
  /** Called when the modal is cancelled or after dispatch is kicked off. */
  onClose: () => void;
  /** The operation to run on confirm. The modal closes before `dispatch` settles. */
  dispatch: () => Promise<unknown> | void;
}

export function ConfirmAndDispatch({
  isOpen,
  onClose,
  dispatch,
  ...rest
}: ConfirmAndDispatchProps) {
  const handleConfirm = useCallback(() => {
    // Fire-and-forget: close the modal immediately and let the caller's
    // OperationDispatcher drive the progress/error UI.
    try {
      void dispatch();
    } catch (err) {
      console.warn('[ConfirmAndDispatch] dispatch threw synchronously:', err);
    }
    onClose();
  }, [dispatch, onClose]);

  return (
    <AlertModal
      {...rest}
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}
