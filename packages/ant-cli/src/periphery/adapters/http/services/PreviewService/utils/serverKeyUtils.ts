/**
 * Preview Server Key Utilities
 * 
 * Re-exports from centralized redisKeyUtils.
 * Preview uses 4-part keys: org:user:project:feature
 * 
 * Two key formats:
 * - Internal (Redis): "org:user:project:feature" (colons)
 * - URL path:         "org--user--project--feature" (double-dash, URL-safe)
 * 
 * URL key may include an optional 5th segment for service targeting:
 * - "org--user--project--feature--serviceName"
 * The 5th segment is NOT part of the internal key — it is extracted separately
 * by parseUrlKey and stripped by fromUrlKey to ensure safe Redis lookups.
 * 
 * The URL format avoids colons in URL path segments, which cause
 * Next.js normalizedAssetPrefix to misinterpret the basePath as a URL scheme
 * (e.g., "to.nexus:" matches [a-z][a-z0-9+\-.]* scheme pattern).
 */

import { 
  createPreviewKey, 
  parsePreviewKey,
} from '../../../../../../infrastructure/state/redisKeyUtils';
import type { ServerKeyComponents } from '../types';

// ── Internal key (Redis) ──

export const createServerKey = createPreviewKey;

export function parseServerKey(serverKey: string): ServerKeyComponents {
  const parsed = parsePreviewKey(serverKey);
  return parsed || { tenantId: '', userId: '', projectId: '', feature: '' };
}

// ── URL-safe key conversion ──
// Internal key uses colons:    "to.nexus:probe:ant-prediction:localtest"
// URL key uses double-dashes:  "to.nexus--probe--ant-prediction--localtest"
// URL key with service:        "to.nexus--probe--ant-prediction--localtest--api"

const URL_KEY_SEPARATOR = '--';
const INTERNAL_KEY_SEPARATOR = ':';

/**
 * Convert internal key (colon-separated) to URL-safe key (double-dash-separated).
 * Used when generating URLs that include the serverKey as a path segment.
 */
export function toUrlKey(internalKey: string): string {
  return internalKey.split(INTERNAL_KEY_SEPARATOR).join(URL_KEY_SEPARATOR);
}

/**
 * Build a URL key with an optional service name suffix.
 * Returns "org--user--project--feature--serviceName" when serviceName is provided,
 * or the standard 4-part key otherwise.
 */
export function toUrlKeyWithService(internalKey: string, serviceName?: string): string {
  const urlKey = toUrlKey(internalKey);
  return serviceName ? `${urlKey}${URL_KEY_SEPARATOR}${serviceName}` : urlKey;
}

/**
 * Convert URL-safe key (double-dash-separated) back to internal key (colon-separated).
 * Only the first 4 segments are converted; the optional 5th segment (serviceName)
 * is stripped to produce a valid Redis lookup key.
 */
export function fromUrlKey(urlKey: string): string {
  const parts = urlKey.split(URL_KEY_SEPARATOR);
  return parts.slice(0, 4).join(INTERNAL_KEY_SEPARATOR);
}

/**
 * Check if a path segment looks like a URL-safe serverKey (contains double-dashes).
 * URL key format: tenantId--userId--projectId--feature[--serviceName] (4 or 5 parts)
 */
export function isUrlKey(segment: string): boolean {
  const parts = segment.split(URL_KEY_SEPARATOR);
  return parts.length >= 4 && parts.length <= 5 && parts.every(p => p.length > 0);
}

/**
 * Convert a monorepo package name (e.g. "apps/web", "@scope/ui") into a URL-safe
 * slug usable as the 5th segment of the urlKey.
 *
 * Constraints:
 *   - No '/' or '\' (would split URL path segments)
 *   - No '--' (would conflict with URL_KEY_SEPARATOR)
 *   - No leading/trailing '-'
 *   - Falls back to "pkg" when input collapses to empty
 *
 * Callers MUST dedupe slugs across packages before persisting (collision rule:
 * append "-2", "-3", …). This helper is stateless — dedupe is the caller's job.
 *
 * SSOT: every consumer that emits or matches a 5-part urlKey segment goes
 * through this function. Do NOT inline `.replace(/[\/_]/g, '-')` elsewhere.
 */
export function packageSlug(name: string): string {
  const slug = name
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'pkg';
}

/**
 * Extract serverKey components (and optional serviceName) from a URL key.
 * Parses directly from the double-dash-separated format without going through
 * fromUrlKey+parsePreviewKey, so the 5th segment is cleanly extracted as serviceName.
 */
export function parseUrlKey(urlKey: string): ServerKeyComponents | null {
  const parts = urlKey.split(URL_KEY_SEPARATOR);
  if (parts.length < 4 || parts.length > 5) return null;
  
  const [tenantId, userId, projectId, feature, serviceName] = parts;
  if (!tenantId || !userId || !projectId || !feature) return null;

  return {
    tenantId,
    userId,
    projectId,
    feature,
    serviceName: serviceName || undefined,
  };
}
