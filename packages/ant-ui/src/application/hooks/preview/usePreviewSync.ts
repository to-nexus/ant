/**
 * usePreviewSync — the single writer for preview state.
 *
 * Mounted exactly once at the app root (see `App.tsx` ambient-hook
 * section). Every SSE registration, every `GET /status` fetch, every
 * visibility/reconnect re-sync for preview lives here.
 *
 * Rationale: previously the Explorer's `FeatureSection` owned SSE and
 * initial fetch, so folding the Explorer (or navigating away from it)
 * silently tore down the sync wiring and the Preview Config Editor
 * stopped receiving updates. Lifting the sync up to App level removes
 * that coupling — the writer outlives every preview-related screen.
 *
 * Invariants:
 *   - Reads `selectedProject` / `selectedFeature` from the store
 *     directly; callers pass nothing.
 *   - Never reads `status`/`isLoading` for rendering; only writes.
 *   - SSE handler is guarded by a store-snapshot project/feature check
 *     (matches `useDeployManager` pattern) so reconnect-window events
 *     that arrive after a feature switch land in the right bucket or
 *     are discarded.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { getPreviewStatus } from '@/infrastructure/http/api';
import type { PreviewStatus, LogEntry } from '@/infrastructure/http/api';

// After a successful POST /start, FE relies exclusively on a single SSE
// event (`phase:'running'` from the async health-check) to clear the
// loading flag. If that event is lost for any reason — SSE drop during
// reconnect, handler registration race, bugs in guard logic, backend
// process churn — the UI stays in a permanent spinner even though the
// server is actually up. This timeout is the safety net: once the
// loading→running transition has been outstanding for this long, we
// fall back to an explicit `GET /status` fetch and merge whatever the
// backend reports.
const LOADING_TIMEOUT_MS = 45_000;

export function usePreviewSync(): void {
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const connectionStatus = useStore((s: any) => s.connectionStatus);

  const mergePreviewStatus = useStore((s: any) => s.mergePreviewStatus);
  const appendPreviewLog = useStore((s: any) => s.appendPreviewLog);

  const featureKey = makeFeatureKey(selectedProject, selectedFeature);

  // Primitive subscription: re-evaluates ONLY when the per-feature
  // loading flag or phase actually flips. Subscribing to the whole entry
  // would re-run the timeout effect on every log append and reset the
  // timer, defeating the 45s window.
  const isLoading = useStore((s: any) =>
    featureKey ? (s.previewByFeature[featureKey]?.isLoading ?? false) : false,
  );
  const phase = useStore((s: any) =>
    featureKey ? (s.previewByFeature[featureKey]?.status?.phase) : undefined,
  );

  // Track latest values inside the SSE handler closure. `useRef` avoids
  // re-registering the handler on every store update; we re-derive the
  // guard check from the store snapshot at event time instead.
  const latestRef = useRef({ selectedProject, selectedFeature, featureKey });
  latestRef.current = { selectedProject, selectedFeature, featureKey };

  // ── Initial fetch on feature switch ─────────────────────────────────
  useEffect(() => {
    if (!featureKey || !selectedProject || !selectedFeature) return;
    let cancelled = false;
    getPreviewStatus(selectedProject, selectedFeature)
      .then((status) => {
        if (cancelled) return;
        // stop guard: if user recently requested stop, ignore a status
        // snapshot that still reports running — the next event will
        // carry the real transition.
        const entry = useStore.getState().previewByFeature[featureKey];
        if (entry && Date.now() < entry.stopGuardUntil && status?.running) return;
        // GET /status never returns `logs` — merge preserves the buffer.
        mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
      })
      .catch((err) => {
        console.error('[usePreviewSync] initial status fetch failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [featureKey, selectedProject, selectedFeature, mergePreviewStatus]);

  // ── SSE reconnect re-sync ───────────────────────────────────────────
  useEffect(() => {
    if (!featureKey || !selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    getPreviewStatus(selectedProject, selectedFeature)
      .then((status) => {
        const entry = useStore.getState().previewByFeature[featureKey];
        if (entry && Date.now() < entry.stopGuardUntil && status?.running) return;
        mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
      })
      .catch(() => { /* silent — next event will catch up */ });
  }, [connectionStatus, featureKey, selectedProject, selectedFeature, mergePreviewStatus]);

  // ── visibilitychange re-validation ─────────────────────────────────
  useEffect(() => {
    if (!featureKey || !selectedProject || !selectedFeature) return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      getPreviewStatus(selectedProject, selectedFeature)
        .then((status) => {
          const entry = useStore.getState().previewByFeature[featureKey];
          if (entry && Date.now() < entry.stopGuardUntil && status?.running) return;
          mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
        })
        .catch(() => { /* silent */ });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [featureKey, selectedProject, selectedFeature, mergePreviewStatus]);

  // ── SSE preview handler ─────────────────────────────────────────────
  // Registered once per (project, feature) tuple. The EventSource itself
  // reconnects on feature switch (handled by SSEManager URL), but inside
  // the reconnect window we may still receive events for the previous
  // feature; the guard below keeps them from landing in the wrong key.
  useEffect(() => {
    if (!featureKey || !selectedProject || !selectedFeature) return;

    const handler = (payload: any) => {
      try {
        const snap = useStore.getState();
        // Guard: drop events that don't match the active selection.
        if (
          snap.selectedProject !== latestRef.current.selectedProject ||
          snap.selectedFeature !== latestRef.current.selectedFeature
        ) {
          return;
        }
        const key = latestRef.current.featureKey;
        if (!key) return;

        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          const entry = snap.previewByFeature[key];
          if (entry && Date.now() < entry.stopGuardUntil && messageData?.running === true) {
            return;
          }
          mergePreviewStatus(key, messageData as Partial<PreviewStatus>);
        } else if (messageType === 'log') {
          appendPreviewLog(key, messageData as LogEntry);
        }
      } catch (err) {
        console.error('[usePreviewSync] handler error:', err);
      }
    };

    const handlerId = sseManager.registerHandlerWithId('preview', handler);
    return () => {
      sseManager.unregisterHandlerById(handlerId);
    };
  }, [featureKey, selectedProject, selectedFeature, mergePreviewStatus, appendPreviewLog]);

  // ── Loading-timeout safety net ──────────────────────────────────────
  // Triggers a single authoritative `GET /status` fetch if the UI has
  // been in a loading state (and NOT reached running) for longer than
  // LOADING_TIMEOUT_MS. Covers SSE event loss after a start, regardless
  // of which of the upstream bugs caused it.
  useEffect(() => {
    if (!featureKey || !selectedProject || !selectedFeature) return;
    if (!isLoading) return;
    if (phase === 'running') return;
    const id = window.setTimeout(() => {
      getPreviewStatus(selectedProject, selectedFeature)
        .then((status) => {
          // The stopGuard does NOT apply here — this path only fires
          // after 45s of loading with no running transition, at which
          // point any legitimate stop window has long expired.
          mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
        })
        .catch((err) => {
          console.error('[usePreviewSync] loading-timeout refetch failed:', err);
        });
    }, LOADING_TIMEOUT_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [featureKey, selectedProject, selectedFeature, isLoading, phase, mergePreviewStatus]);
}
