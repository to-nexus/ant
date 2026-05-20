/**
 * Tenant-scoped Redis cache for compaction-aware baseline estimates.
 *
 * Key SSOT lives in [`REDIS_KEYS.BASELINE.KEY`](../constants/redis.ts) — never
 * concatenate the prefix here. 300s TTL amortises the Anthropic countTokens
 * call across rapid keystrokes inside the FE's 300ms debounce window.
 *
 * Scoping (orgId / userId / projectId / featureName) mirrors the convention
 * used by TRANSFER / ARTIFACTS / LOCK so cross-tenant leakage is structurally
 * impossible.
 */

import { createHash } from 'crypto';
import type { StateStorePort } from '../ports/stateStore';
import type { BaselineEstimate, IntentId, ResolvedArtifact } from '@ant/shared';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis';

export interface BaselineTenantScope {
  orgId: string;
  userId: string;
  projectId: string;
  featureName: string;
}

export interface BaselineCacheScope extends BaselineTenantScope {
  intent: IntentId;
  modelId: string;
  racFingerprint: string;
  draftHash: string;
}

export function fingerprintRac(artifacts: readonly ResolvedArtifact[]): string {
  if (artifacts.length === 0) return 'empty';
  const parts = [...artifacts]
    .map(a => `${a.path}|${a.content?.length ?? 0}|${a.role ?? ''}`)
    .sort();
  return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export function fingerprintDraft(draftText: string | undefined): string {
  if (!draftText) return 'empty';
  return createHash('sha1').update(draftText).digest('hex').slice(0, 16);
}

export function buildCacheKey(scope: BaselineCacheScope): string {
  return REDIS_KEYS.BASELINE.KEY(
    scope.orgId,
    scope.userId,
    scope.projectId,
    scope.featureName,
    scope.intent,
    scope.modelId,
    scope.racFingerprint,
    scope.draftHash,
  );
}

export async function getCached(
  stateStore: StateStorePort,
  scope: BaselineCacheScope,
): Promise<BaselineEstimate | undefined> {
  const raw = await stateStore.getKey(buildCacheKey(scope));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as BaselineEstimate;
  } catch {
    return undefined;
  }
}

export async function setCached(
  stateStore: StateStorePort,
  scope: BaselineCacheScope,
  estimate: BaselineEstimate,
): Promise<void> {
  await stateStore.setKeyWithTTL(
    buildCacheKey(scope),
    JSON.stringify(estimate),
    REDIS_TTL.BASELINE.ENTRY,
  );
}
