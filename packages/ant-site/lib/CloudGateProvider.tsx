'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ComingSoonModal } from '@/components/ComingSoonModal';
import { CLOUD_APP_BASE } from './apiBase';
import { useAuthSession } from './AuthSessionProvider';

interface CloudGateContextValue {
  /** True when links into the managed cloud must not navigate. */
  cloudBlocked: boolean;
  /** Opens the "coming soon" dialog. No-op semantics are the caller's choice. */
  requestCloud: () => void;
}

const CloudGateContext = createContext<CloudGateContextValue | null>(null);

/**
 * Gate for the two CTAs that leave for the managed cloud
 * (`getCloudAppUrl` / `getCloudBillingUrl`).
 *
 * Blocked when this is a local-mode build — the hosted product is not open yet,
 * so a self-hoster clicking "Try ANT Cloud" would land on a sign-up they cannot
 * complete. Also blocked when `NEXT_PUBLIC_CLOUD_APP_BASE` is unset, where the
 * URL builders return '' and an `<a href="">` would silently reload the page.
 *
 * Scope is deliberately narrow: only links that *leave* for the cloud host. The
 * `/cloud` page itself, the nav/footer links to it, and the pricing table stay
 * fully readable — LLM usage is billed by your provider in local mode too, so
 * the prices are still real information.
 *
 * The dialog is mounted once here rather than per consumer, because `/cloud`
 * renders both gated CTAs and two independent copies would stack.
 */
export function CloudGateProvider({ children }: { children: ReactNode }) {
  const { serverMode } = useAuthSession();
  const { t } = useTranslation('site');
  const [open, setOpen] = useState(false);

  const cloudBlocked = serverMode === 'local' || !CLOUD_APP_BASE;
  const requestCloud = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ cloudBlocked, requestCloud }),
    [cloudBlocked, requestCloud],
  );

  return (
    <CloudGateContext.Provider value={value}>
      {children}
      <ComingSoonModal
        open={open}
        onClose={close}
        title={t('cloudGate.title')}
        body={t('cloudGate.body')}
        closeLabel={t('cloudGate.close')}
        dismissLabel={t('cloudGate.dismiss')}
        action={{ href: '/self-host', label: t('cloudGate.selfHostCta') }}
      />
    </CloudGateContext.Provider>
  );
}

export function useCloudGate(): CloudGateContextValue {
  const ctx = useContext(CloudGateContext);
  if (!ctx) {
    throw new Error('useCloudGate must be used within <CloudGateProvider>');
  }
  return ctx;
}
