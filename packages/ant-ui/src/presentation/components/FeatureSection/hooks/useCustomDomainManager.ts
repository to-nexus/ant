import { useEffect, useCallback } from 'react';
import { useStore } from '@/domain/store';
import {
  makeFeatureKey,
  selectCustomDomains,
  selectCustomDomainEnabled,
} from '@/domain/store/slices/deploySlice';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import {
  registerCustomDomain,
  verifyCustomDomain,
  deleteCustomDomain,
} from '@/infrastructure/http/api';
import type { CustomDomainWithDns, CustomDomainTarget } from '@/infrastructure/http/api';
import type { CustomDomainStatusEventData } from '@ant/shared';

export interface UseCustomDomainManagerResult {
  domains: CustomDomainWithDns[];
  enabled: boolean;
  register: (
    hostname: string,
    target: CustomDomainTarget,
    slug?: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  verify: (hostname: string) => Promise<void>;
  remove: (hostname: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * useCustomDomainManager — deploy-only custom-domain management. Fetches the
 * feature's domains, listens for `customDomainStatus` SSE, and exposes
 * register/verify/delete. Per-feature isolation via `${projectId}:${feature}`.
 */
export function useCustomDomainManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  options?: { primary?: boolean },
): UseCustomDomainManagerResult {
  const isPrimary = options?.primary ?? false;
  const featureKey = makeFeatureKey(selectedProject, selectedFeature);

  const domains = useStore((s: any) => selectCustomDomains(s, featureKey));
  const enabled = useStore((s: any) => selectCustomDomainEnabled(s, featureKey));
  const applyCustomDomainEvent = useStore((s: any) => s.applyCustomDomainEvent);
  const refreshCustomDomains = useStore((s: any) => s.refreshCustomDomains);

  const refresh = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;
    await refreshCustomDomains(selectedProject, selectedFeature);
  }, [selectedProject, selectedFeature, refreshCustomDomains]);

  // Initial fetch + re-fetch on feature switch.
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    void refreshCustomDomains(selectedProject, selectedFeature);
  }, [isPrimary, featureKey, selectedProject, selectedFeature, refreshCustomDomains]);

  // SSE — realtime status/cert progress. Unknown hostname (registered on another
  // tab) triggers a full re-fetch so the new row appears.
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    const handler = (payload: CustomDomainStatusEventData) => {
      try {
        const s = useStore.getState();
        if (s.selectedProject !== selectedProject || s.selectedFeature !== selectedFeature) return;
        if (payload.projectId !== selectedProject || payload.feature !== selectedFeature) return;
        const known = (s.customDomainsByFeature[featureKey] ?? []).some(
          (d: CustomDomainWithDns) => d.hostname === payload.hostname,
        );
        if (!known && !(payload.status === 'error' && payload.error === 'removed')) {
          void refreshCustomDomains(selectedProject, selectedFeature);
          return;
        }
        applyCustomDomainEvent(featureKey, payload);
      } catch (err) {
        console.error('[useCustomDomainManager] handler error:', err);
      }
    };
    const handlerId = sseManager.registerHandlerWithId('customDomainStatus', handler);
    return () => sseManager.unregisterHandlerById(handlerId);
  }, [isPrimary, featureKey, selectedProject, selectedFeature, applyCustomDomainEvent, refreshCustomDomains]);

  const register = useCallback(
    async (hostname: string, target: CustomDomainTarget, slug?: string) => {
      if (!selectedProject || !selectedFeature) return { ok: false, message: 'No feature selected' };
      try {
        const res = await registerCustomDomain(selectedProject, selectedFeature, hostname, target, slug);
        if (!res.success) return { ok: false, message: res.message };
        await refreshCustomDomains(selectedProject, selectedFeature);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message ?? 'Failed to register domain' };
      }
    },
    [selectedProject, selectedFeature, refreshCustomDomains],
  );

  const verify = useCallback(
    async (hostname: string) => {
      if (!selectedProject || !selectedFeature) return;
      try {
        await verifyCustomDomain(selectedProject, selectedFeature, hostname);
      } catch (err) {
        console.error('[useCustomDomainManager] verify error:', err);
      } finally {
        await refreshCustomDomains(selectedProject, selectedFeature);
      }
    },
    [selectedProject, selectedFeature, refreshCustomDomains],
  );

  const remove = useCallback(
    async (hostname: string) => {
      if (!selectedProject || !selectedFeature) return;
      try {
        await deleteCustomDomain(selectedProject, selectedFeature, hostname);
      } catch (err) {
        console.error('[useCustomDomainManager] delete error:', err);
      } finally {
        await refreshCustomDomains(selectedProject, selectedFeature);
      }
    },
    [selectedProject, selectedFeature, refreshCustomDomains],
  );

  return { domains, enabled, register, verify, remove, refresh };
}
