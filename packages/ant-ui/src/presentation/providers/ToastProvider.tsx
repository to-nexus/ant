/**
 * ToastProvider
 *
 * Global context for non-blocking toast notifications.
 * Wrap at the app root alongside AlertModalProvider.
 *
 * Usage in components:
 *   const { toast } = useToastContext();
 *   toast.success('Deleted successfully');
 *   toast.error('Something went wrong');
 */

import React, { createContext, useContext } from 'react';
import { useToast, type ToastApi } from '@/application/hooks/ui/useToast';
import { ToastContainer } from '@/presentation/components/common/Toast';

interface ToastContextValue {
  toast: ToastApi;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, toast, removeToast } = useToast();

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToastContext must be used within ToastProvider');
  }
  return ctx;
}
