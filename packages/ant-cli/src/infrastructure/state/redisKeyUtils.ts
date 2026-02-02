/**
 * Redis Key Utilities
 * 
 * Centralized key generation and parsing for all Redis operations.
 * 
 * Key Formats:
 * - IDE:     org:user:project     (3 parts) - project-level, branch switching via git
 * - Preview: org:user:project:feature (4 parts) - feature-level
 */

// ============================================
// IDE Keys (3 parts: org:user:project)
// ============================================

export interface IDEKeyComponents {
  tenantId: string;  // org
  userId: string;
  projectId: string;
}

/**
 * Create IDE port key (3 parts)
 * Used for Redis key: ant:ide:{org}:{user}:{project}
 */
export function createIDEKey(
  tenantId: string,
  userId: string,
  projectId: string
): string {
  return `${tenantId}:${userId}:${projectId}`;
}

/**
 * Parse IDE key into components
 * @param key - Format: org:user:project (3 parts)
 * @returns Components or null if invalid format
 */
export function parseIDEKey(key: string): IDEKeyComponents | null {
  const parts = key.split(':');
  
  if (parts.length !== 3) {
    return null;
  }
  
  const [tenantId, userId, projectId] = parts;
  
  if (!tenantId || !userId || !projectId) {
    return null;
  }
  
  return { tenantId, userId, projectId };
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

// ============================================
// Aliases for backward compatibility
// ============================================

// IDE aliases (for clarity in different contexts)
export const createIDEInstanceKey = createIDEKey;
export const parseIDEInstanceKey = parseIDEKey;
export const createIDEPortKey = createIDEKey;

// Preview aliases
export const createPreviewInstanceKey = createPreviewKey;
export const parsePreviewInstanceKey = parsePreviewKey;
export const createPreviewPortKey = createPreviewKey;
