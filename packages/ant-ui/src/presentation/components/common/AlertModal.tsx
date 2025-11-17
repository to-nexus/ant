/**
 * AlertModal Component
 * 
 * Typed modal for alerts, confirmations, and user feedback
 * 
 * Types:
 * - info: Informational message (blue)
 * - success: Positive feedback (green)
 * - warning: Warning message (orange)
 * - error: Error message (red)
 * 
 * Button Modes:
 * - confirm-only: Single OK button
 * - confirm-cancel: OK and Cancel buttons
 */

import { Modal } from './Modal';
import { CheckCircle, AlertCircle, XCircle, Info } from 'lucide-react';

export type AlertType = 'info' | 'success' | 'warning' | 'error';
export type ButtonMode = 'confirm-only' | 'confirm-cancel';

export interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type?: AlertType;
  title: string;
  message: string | React.ReactNode;
  showIcon?: boolean;
  buttonMode?: ButtonMode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

const TYPE_STYLES = {
  info: {
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    confirmButton: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600',
  },
  success: {
    icon: CheckCircle,
    iconColor: 'text-green-600 dark:text-green-400',
    iconBg: 'bg-green-100 dark:bg-green-900/30',
    confirmButton: 'bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600',
  },
  warning: {
    icon: AlertCircle,
    iconColor: 'text-orange-600 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    confirmButton: 'bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600',
  },
  error: {
    icon: XCircle,
    iconColor: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    confirmButton: 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600',
  },
};

export function AlertModal({
  isOpen,
  onClose,
  type = 'info',
  title,
  message,
  showIcon = true,
  buttonMode = 'confirm-only',
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: AlertModalProps) {
  const styles = TYPE_STYLES[type];
  const Icon = styles.icon;

  const handleConfirm = async () => {
    if (onConfirm) {
      await onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={title} size="sm">
      <div className="space-y-4">
        {/* Icon + Message */}
        <div className="flex items-start gap-3">
          {showIcon && (
            <div className={`flex-shrink-0 w-10 h-10 rounded-full ${styles.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${styles.iconColor}`} />
            </div>
          )}
          <div className="flex-1 pt-1">
            {typeof message === 'string' ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {message}
              </p>
            ) : (
              message
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {buttonMode === 'confirm-cancel' && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 
                       bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 
                       rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 
                       focus:outline-none focus:ring-2 focus:ring-gray-500 
                       transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md 
                       focus:outline-none focus:ring-2 focus:ring-offset-2 
                       transition-colors ${styles.confirmButton}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

