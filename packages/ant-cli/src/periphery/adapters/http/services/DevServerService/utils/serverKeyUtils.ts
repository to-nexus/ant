import { ServerKeyComponents } from '../types';

/**
 * Create unique server key: tenantId:userId:projectId:feature
 */
export function createServerKey(
  tenantId: string,
  userId: string,
  projectId: string,
  feature: string
): string {
  return `${tenantId}:${userId}:${projectId}:${feature}`;
}

/**
 * Parse server key into components
 */
export function parseServerKey(serverKey: string): ServerKeyComponents {
  const [tenantId, userId, projectId, feature] = serverKey.split(':');
  return { tenantId, userId, projectId, feature };
}

