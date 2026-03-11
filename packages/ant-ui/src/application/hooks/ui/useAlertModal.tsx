/**
 * useAlertModal Hook
 * 
 * Provides a simple API to show alert/confirm dialogs
 * Replaces window.alert() with branded modal dialogs
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertModal, AlertType, ButtonMode } from '@/presentation/components/common/AlertModal';

interface AlertOptions {
  type?: AlertType;
  title?: string;
  showIcon?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
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
  const { t } = useTranslation('common');

  const [state, setState] = useState<AlertState>({
    isOpen: false,
    type: 'info',
    title: '',
    message: '',
    showIcon: true,
    buttonMode: 'confirm-only',
    confirmText: '',
    cancelText: '',
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
      title: options?.title || t('info.title'),
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || t('button.ok'),
      cancelText: options?.cancelText || t('button.cancel'),
    });
  };

  /**
   * Show a success alert (confirm-only)
   */
  const showSuccess = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'success',
      title: options?.title || t('success.title'),
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || t('button.ok'),
      cancelText: options?.cancelText || t('button.cancel'),
    });
  };

  /**
   * Show a warning alert (confirm-only)
   */
  const showWarning = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'warning',
      title: options?.title || t('warning.title'),
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || t('button.ok'),
      cancelText: options?.cancelText || t('button.cancel'),
    });
  };

  /**
   * Show an error alert (confirm-only)
   */
  const showError = (message: string | React.ReactNode, options?: AlertOptions) => {
    setState({
      isOpen: true,
      type: 'error',
      title: options?.title || t('error.title'),
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-only',
      confirmText: options?.confirmText || t('button.ok'),
      cancelText: options?.cancelText || t('button.cancel'),
      onConfirm: options?.onConfirm,
    });
  };

  /**
   * Show a confirmation dialog (confirm-cancel)
   */
  const showConfirm = (message: string | React.ReactNode, options?: ConfirmOptions) => {
    setState({
      isOpen: true,
      type: options?.type || 'warning',
      title: options?.title || t('confirm.title'),
      message,
      showIcon: options?.showIcon ?? true,
      buttonMode: 'confirm-cancel',
      confirmText: options?.confirmText || t('button.confirm'),
      cancelText: options?.cancelText || t('button.cancel'),
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

