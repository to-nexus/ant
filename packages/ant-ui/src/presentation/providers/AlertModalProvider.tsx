import React, { createContext, useContext } from 'react';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

type AlertModalApi = ReturnType<typeof useAlertModal>;

const AlertModalContext = createContext<AlertModalApi | null>(null);

export function AlertModalProvider({ children }: { children: React.ReactNode }) {
  const api = useAlertModal();

  return (
    <AlertModalContext.Provider value={api}>
      {children}
      {/* ✅ Single global modal instance (removes scattered <AlertModal /> usage) */}
      <api.AlertModal />
    </AlertModalContext.Provider>
  );
}

export function useAlertModalContext(): AlertModalApi {
  const ctx = useContext(AlertModalContext);
  if (!ctx) {
    throw new Error('useAlertModalContext must be used within AlertModalProvider');
  }
  return ctx;
}


