/**
 * Redis Key Utilities
 *
 * Centralized key generation and parsing for all Redis operations.
 *
 * Key Formats:
 * - IDE:     org:user:project:feature (4 parts) - feature-level (worktree-based isolation)
 * - Preview: org:user:project:feature (4 parts) - feature-level
 *
 * The `feature` segment is stored as a `/`-free slug (a feature name may
 * contain `/`). This keeps the IDE serverKey — which is embedded in the
 * `/ide/{key}` proxy URL — a single path segment. Create slugifies, parse
 * decodes; slash-free names are their own slug (no-op), so existing keys are
 * byte-identical.
 */
import { featureNameToSlug, featureSlugToName } from '@ant/shared';

/**
 * Internal key segment used when a record is not scoped to a feature.
 * Routes require a feature for every IDE/job surface, so this exists only
 * as a defensive parser/creator fallback for malformed inputs — it is NOT a
 * user-visible feature name ('@' is invalid in feature names by validation,
 * so it can never collide with a real feature).
 */
export const NO_FEATURE_KEY = '@none';

// ============================================
// IDE Keys (4 parts: org:user:project:feature)
// ============================================

export interface IDEKeyComponents {
  tenantId: string;  // org
  userId: string;
  projectId: string;
  feature: string;
}

/**
 * Create IDE port key (4 parts)
 * Used for Redis key: ant:ide:{org}:{user}:{project}:{feature}
 * 
 * @throws Error if any parameter is empty
 */
export function createIDEKey(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string = NO_FEATURE_KEY
): string {
  // Validate all parts are non-empty
  if (!tenantId || !userId || !projectId) {
    const error = `Invalid IDE key components: tenantId=${tenantId}, userId=${userId}, projectId=${projectId}`;
    console.error(`[createIDEKey] ERROR: ${error}`);
    throw new Error(error);
  }
  return `${tenantId}:${userId}:${projectId}:${featureNameToSlug(feature || NO_FEATURE_KEY)}`;
}

/**
 * Parse IDE key into components
 * @param key - Format: org:user:project:feature (4 parts)
 * @returns Components or null if invalid format
 */
export function parseIDEKey(key: string): IDEKeyComponents | null {
  const parts = key.split(':');

  if (parts.length < 4) {
    return null;
  }

  const [tenantId, userId, projectId, ...featureParts] = parts;
  const feature = featureSlugToName(featureParts.join(':')) || NO_FEATURE_KEY;
  
  if (!tenantId || !userId || !projectId) {
    return null;
  }
  
  return { tenantId, userId, projectId, feature };
}

// ============================================
// Preview Keys (4 parts: org:user:project:feature)
// ============================================

export interface PreviewKeyComponents {
  tenantId: string;  // org
  userId: string;
  projectId: string;
  feature: string;
}

/**
 * Create Preview port key (4 parts)
 * Used for Redis key: ant:preview:{org}:{user}:{project}:{feature}
 */
export function createPreviewKey(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string
): string {
  return `${tenantId}:${userId}:${projectId}:${featureNameToSlug(feature)}`;
}

/**
 * Parse Preview key into components
 * @param key - Format: org:user:project:feature (4 parts)
 * @returns Components or null if invalid format
 */
export function parsePreviewKey(key: string): PreviewKeyComponents | null {
  const parts = key.split(':');
  
  if (parts.length < 4) {
    return null;
  }
  
  const [tenantId, userId, projectId, ...featureParts] = parts;
  const feature = featureSlugToName(featureParts.join(':'));  // stored as a slug
  
  if (!tenantId || !userId || !projectId || !feature) {
    return null;
  }
  
  return { tenantId, userId, projectId, feature };
}

// ============================================
// Deploy Keys (same format as Preview: org:user:project:feature)
// ============================================

export type DeployKeyComponents = PreviewKeyComponents;

/**
 * Create Deploy key (4 parts)
 * Used for Redis key: ant:infra:deploy:{org}:{user}:{project}:{feature}
 */
export function createDeployKey(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string
): string {
  return `${tenantId}:${userId}:${projectId}:${featureNameToSlug(feature)}`;
}

/**
 * Parse Deploy key into components (identical format to Preview key)
 */
export const parseDeployKey = parsePreviewKey;

