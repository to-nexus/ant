'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BillingCatalog } from '@ant/shared';
import { CATALOG_API_BASE } from './apiBase';

/**
 * Pricing catalog fetch state.
 *
 * The marketing site always fetches cloud prices from the canonical cloud
 * catalog (`GET /billing/catalog`) — regardless of build mode — so visitors
 * see real plan pricing inline rather than a link out. Prices arrive only on
 * `cloud` status, straight from the server; nothing is baked into the bundle.
 *
 * `unavailable` is the convergent fallback for every no-pricing path (404 from a
 * backend without the billing surface, network/CORS failure, etc.). The UI shows
 * a brief self-host note plus a retry, never a dead end.
 */
export type PricingState =
  | { status: 'loading' }
  | { status: 'cloud'; catalog: BillingCatalog }
  | { status: 'unavailable'; retry: () => void };

export function usePricingCatalog(): PricingState {
  const [state, setState] = useState<PricingState>({ status: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const res = await fetch(`${CATALOG_API_BASE}/billing/catalog`, {
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const catalog = (await res.json()) as BillingCatalog;
        if (!cancelled) setState({ status: 'cloud', catalog });
      } catch {
        if (!cancelled) setState({ status: 'unavailable', retry: () => load() });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return state;
}
