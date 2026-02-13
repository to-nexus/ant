/**
 * useToast Hook
 *
 * Manages toast notification state.
 * Provides methods to show non-blocking notifications.
 *
 * Usage:
 *   const { toasts, toast, removeToast } = useToast();
 *   toast.success('Item deleted');
 *   toast.error('Something went wrong');
 */

import { useState, useCallback } from 'react';
import type { ToastItem, ToastType } from '@/presentation/components/common/Toast';

const DEFAULT_DURATION = 3000; // 3 seconds

let toastIdCounter = 0;

function generateId(): string {
  toastIdCounter += 1;
  return `toast-${Date.now()}-${toastIdCounter}`;
}

export interface ToastApi {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = DEFAULT_DURATION) => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const toast: ToastApi = {
    success: useCallback((message: string, duration?: number) => addToast('success', message, duration), [addToast]),
    error: useCallback((message: string, duration?: number) => addToast('error', message, duration), [addToast]),
    info: useCallback((message: string, duration?: number) => addToast('info', message, duration), [addToast]),
    warning: useCallback((message: string, duration?: number) => addToast('warning', message, duration), [addToast]),
  };

  return {
    toasts,
    toast,
    removeToast,
  };
}
