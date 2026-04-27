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
 * dusk-mounding-pilot — also mirror `ActionConfigView`'s target-derivation
 * for chat-driven explicit submits. The BE detect node carries the same
 * matrix-derived fallback (`detect/index.ts` explicit branch), so the FE
 * value is purely cosmetic — but seeing the canonical target in the
 * `actionMetadata` badges before submit makes the explicit pipeline
 * legible and protects against unrelated paths bypassing the BE fallback.
 *
 * Mount once at the app root so sync runs regardless of which panel is visible.
 */

import { useEffect, useRef } from 'react';
import { getDefaultTargetPaths, type IntentId } from '@ant/shared';
import { useStore } from '@/domain/store';
import { useActionFooterPolicy } from './useActionFooterPolicy';

export function useExplicitAutoSync(): void {
  const { canStartChat } = useActionFooterPolicy();
  const intent = useStore(s => s.actionMetadata.intent);
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

  // Auto-target derivation. Triggered whenever the intent changes (or
  // canStartChat gates explicit on) so the user-visible badge reflects
  // what BE will resolve. Skips when the user has already populated
  // `target` via ActionConfigView (manual selection wins) or when the
  // matrix has no synthesisable target (revise / codebase / chat-only).
  useEffect(() => {
    const store = useStore.getState();
    const meta = store.actionMetadata;

    if (!meta.intent) return;
    if (meta.target?.length) return;

    const defaults = getDefaultTargetPaths(meta.intent as IntentId);
    if (!defaults?.length) return;

    store.updateActionMetadata({ target: defaults });
  }, [intent, canStartChat]);
}
