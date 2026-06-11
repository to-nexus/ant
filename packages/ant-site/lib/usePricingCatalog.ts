'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BillingCatalog } from '@ant/shared';
import { API_BASE, SERVER_MODE } from './apiBase';

/**
 * Pricing catalog fetch state.
 *
 * `self-host` is the convergent fallback for the two no-cloud-pricing paths:
 *   - local-mode build (empty `NEXT_PUBLIC_API_BASE`) — no fetch is attempted.
 *   - a backend without the billing surface — `/billing/catalog` is absent and
 *     returns 404. Billing is always-on today, so this is the forward-compat
 *     path for a future OSS build without the `@ant/cloud` package.
 *
 * The marketing site never embeds prices: `catalog` arrives only on `cloud`
 * status, straight from the server-driven `GET /billing/catalog`.
 */
export type PricingState =
  | { status: 'loading' }
  | { status: 'cloud'; catalog: BillingCatalog }
  | { status: 'self-host' }
  | { status: 'error'; retry: () => void };

export function usePricingCatalog(): PricingState {
  const [state, setState] = useState<PricingState>(
    SERVER_MODE === 'local' ? { status: 'self-host' } : { status: 'loading' },
  );

  const load = useCallback(() => {
    // Local-mode build: no backend round-trip available; stay on the
    // self-host fallback without touching the network.
    if (SERVER_MODE === 'local') {
      setState({ status: 'self-host' });
      return () => {};
    }

    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/billing/catalog`, {
          headers: { Accept: 'application/json' },
        });
        if (cancelled) return;
        // 404 ⇒ no billing surface on this backend (e.g. a future OSS build
        // without `@ant/cloud`): degrade to self-host rather than erroring.
        if (res.status === 404) {
          setState({ status: 'self-host' });
          return;
        }
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const catalog = (await res.json()) as BillingCatalog;
        if (!cancelled) setState({ status: 'cloud', catalog });
      } catch {
        if (!cancelled) setState({ status: 'error', retry: () => load() });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return state;
}
