/**
 * Toast Component
 *
 * Non-blocking notification that auto-dismisses.
 * Use for quick feedback (success, error, info, warning) that doesn't require user action.
 *
 * Unlike AlertModal (blocking, singleton), Toast:
 * - Can show multiple notifications simultaneously (stacked)
 * - Auto-dismisses after a configurable duration
 * - Does not block user interaction
 * - Renders via Portal at document.body level
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

const TOAST_STYLES: Record<ToastType, {
  icon: typeof CheckCircle;
  iconColor: string;
  bg: string;
  border: string;
  progress: string;
}> = {
  success: {
    icon: CheckCircle,
    iconColor: 'text-green-500 dark:text-green-400',
    bg: 'bg-white dark:bg-[#1c2128]',
    border: 'border-green-200 dark:border-green-800',
    progress: 'bg-green-500 dark:bg-green-400',
  },
  error: {
    icon: XCircle,
    iconColor: 'text-red-500 dark:text-red-400',
    bg: 'bg-white dark:bg-[#1c2128]',
    border: 'border-red-200 dark:border-red-800',
    progress: 'bg-red-500 dark:bg-red-400',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-500 dark:text-blue-400',
    bg: 'bg-white dark:bg-[#1c2128]',
    border: 'border-blue-200 dark:border-blue-800',
    progress: 'bg-blue-500 dark:bg-blue-400',
  },
  warning: {
    icon: AlertCircle,
    iconColor: 'text-orange-500 dark:text-orange-400',
    bg: 'bg-white dark:bg-[#1c2128]',
    border: 'border-orange-200 dark:border-orange-800',
    progress: 'bg-orange-500 dark:bg-orange-400',
  },
};

interface ToastItemProps {
  toast: ToastItem;
  onRemove: (id: string) => void;
}

function ToastItemComponent({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);
  const styles = TOAST_STYLES[toast.type];
  const Icon = styles.icon;

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, toast.duration - 250); // Start exit animation before removal

    const removeTimer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 250);
  };

  return (
    <div
      className={`
        relative flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border
        min-w-[280px] max-w-[400px] overflow-hidden
        ${styles.bg} ${styles.border}
        ${isExiting ? 'animate-toast-out' : 'animate-toast-in'}
      `}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${styles.iconColor}`} />
      <p className="flex-1 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
        {toast.message}
      </p>
      <button
        onClick={handleClose}
        className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <X className="w-4 h-4 text-gray-400 dark:text-gray-500" />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full ${styles.progress}`}
          style={{
            animation: `shrink-progress ${toast.duration}ms linear forwards`,
          }}
        />
      </div>

      {/* Inline style for progress animation */}
      <style>{`
        @keyframes shrink-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed top-20 right-4 z-[10000] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItemComponent toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>,
    document.body
  );
}
