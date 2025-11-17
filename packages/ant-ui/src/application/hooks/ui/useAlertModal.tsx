/**
 * useAlertModal Hook
 * 
 * Provides a simple API to show alert/confirm dialogs
 * Replaces window.alert() with branded modal dialogs
 */

import { useState } from 'react';
import { AlertModal, AlertType, ButtonMode } from '@/presentation/components/common/AlertModal';

interface AlertOptions {
  type?: AlertType;
  title?: string;
  showIcon?: boolean;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmOptions extends AlertOptions {
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface AlertState {
  isOpen: boolean;
  type: AlertType;
  title: string;
  message: string | React.ReactNode;
  showIcon: boolean;
  buttonMode: ButtonMode;
  confirmText: string;
  cancelText: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export function useAlertModal() {
  const [state, setState] = useState<AlertState>({
    isOpen: false,
    type: 'info',
    title: 'Notice',
    message: '',
    showIcon: true,
    buttonMode: 'confirm-only',
    confirmText: 'OK',
    cancelText: 'Cancel',
  });

  const close = () => {
    setState(prev => ({ ...prev, isOpen: false }));
  };

  /**
   * Show an info alert (confirm-only)
   */
  const showInfo = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: options?.type || 'info',
      title: options?.title || 'Notice',
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || 'OK',
      cancelText: options?.cancelText || 'Cancel',
    });
  };

  /**
   * Show a success alert (confirm-only)
   */
  const showSuccess = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'success',
      title: options?.title || 'Success',
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || 'OK',
      cancelText: options?.cancelText || 'Cancel',
    });
  };

  /**
   * Show a warning alert (confirm-only)
   */
  const showWarning = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'warning',
      title: options?.title || 'Warning',
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || 'OK',
      cancelText: options?.cancelText || 'Cancel',
    });
  };

  /**
   * Show an error alert (confirm-only)
   */
  const showError = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'error',
      title: options?.title || 'Error',
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || 'OK',
      cancelText: options?.cancelText || 'Cancel',
    });
  };

  /**
   * Show a confirmation dialog (confirm-cancel)
   */
  const showConfirm = (message: string | React.ReactNode, options?: ConfirmOptions) => {
    setState({
      isOpen: true,
      type: options?.type || 'warning',
      title: options?.title || 'Confirm',
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-cancel',
      confirmText: options?.confirmText || 'Confirm',
      cancelText: options?.cancelText || 'Cancel',
      onConfirm: options?.onConfirm,
      onCancel: options?.onCancel,
    });
  };

  const AlertModalComponent = () => (
    <AlertModal
      isOpen={state.isOpen}
      onClose={close}
      type={state.type}
      title={state.title}
      message={state.message}
      showIcon={state.showIcon}
      buttonMode={state.buttonMode}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      onConfirm={state.onConfirm}
      onCancel={state.onCancel}
    />
  );

  return {
    showInfo,
    showSuccess,
    showWarning,
    showError,
    showConfirm,
    AlertModal: AlertModalComponent,
  };
}

