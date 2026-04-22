/**
 * Explicit Auto-Sync Hook
 *
 * Maintains the invariant: `actionMetadata.explicit === true`
 * ⇒ metadata is complete enough to bypass triage safely.
 *
 * Rules:
 * - Rising edge (canStartChat: false → true) → auto-set explicit=true (once).
 * - canStartChat === false → auto-clear explicit (level, invariant guard).
 * - Manual removal: always allowed (badge X, mention removal).
 * - Manual set: allowed only when canStartChat === true (enforced at call sites).
 *
 * Mount once at the app root so sync runs regardless of which panel is visible.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';
import { useActionFooterPolicy } from './useActionFooterPolicy';

export function useExplicitAutoSync(): void {
  const { canStartChat } = useActionFooterPolicy();
  const prevRef = useRef<boolean | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = canStartChat;

    const store = useStore.getState();
    const currentExplicit = store.actionMetadata.explicit === true;

    if (!canStartChat) {
      if (currentExplicit) {
        store.updateActionMetadata({ explicit: undefined });
      }
      return;
    }

    if (prev !== true && !currentExplicit) {
      store.updateActionMetadata({ explicit: true });
    }
  }, [canStartChat]);
}
