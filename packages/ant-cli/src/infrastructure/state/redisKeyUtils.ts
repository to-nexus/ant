/**
 * Redis Key Utilities
 * 
 * Centralized key generation and parsing for all Redis operations.
 * 
 * Key Formats:
 * - IDE:     org:user:project:feature (4 parts) - feature-level (worktree-based isolation)
 * - Preview: org:user:project:feature (4 parts) - feature-level
 */

import { RESERVED_FEATURE_NAME } from '../../core/utils/branchUtils';

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
  feature: string = RESERVED_FEATURE_NAME
): string {
  // Validate all parts are non-empty
  if (!tenantId || !userId || !projectId) {
    const error = `Invalid IDE key components: tenantId=${tenantId}, userId=${userId}, projectId=${projectId}`;
    console.error(`[createIDEKey] ERROR: ${error}`);
    throw new Error(error);
  }
  return `${tenantId}:${userId}:${projectId}:${feature || RESERVED_FEATURE_NAME}`;
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
  const feature = featureParts.join(':') || RESERVED_FEATURE_NAME;
  
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
  return `${tenantId}:${userId}:${projectId}:${feature}`;
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
  const feature = featureParts.join(':');  // feature can contain colons
  
  if (!tenantId || !userId || !projectId || !feature) {
    return null;
  }
  
  return { tenantId, userId, projectId, feature };
}

