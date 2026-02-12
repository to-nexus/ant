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
 * The URL format avoids colons in URL path segments, which cause
 * Next.js normalizedAssetPrefix to misinterpret the basePath as a URL scheme
 * (e.g., "to.nexus:" matches [a-z][a-z0-9+\-.]* scheme pattern).
 */

import { 
  createPreviewKey, 
  parsePreviewKey,
  PreviewKeyComponents 
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
 * Convert URL-safe key (double-dash-separated) back to internal key (colon-separated).
 * Used when receiving a URL path and needing to look up Redis state.
 */
export function fromUrlKey(urlKey: string): string {
  return urlKey.split(URL_KEY_SEPARATOR).join(INTERNAL_KEY_SEPARATOR);
}

/**
 * Check if a path segment looks like a URL-safe serverKey (contains double-dashes).
 * URL key format: tenantId--userId--projectId--feature (at least 4 parts)
 */
export function isUrlKey(segment: string): boolean {
  const parts = segment.split(URL_KEY_SEPARATOR);
  return parts.length >= 4 && parts.every(p => p.length > 0);
}

/**
 * Extract serverKey components from a URL key.
 * Converts to internal format first, then parses.
 */
export function parseUrlKey(urlKey: string): ServerKeyComponents | null {
  const internalKey = fromUrlKey(urlKey);
  return parsePreviewKey(internalKey);
}

