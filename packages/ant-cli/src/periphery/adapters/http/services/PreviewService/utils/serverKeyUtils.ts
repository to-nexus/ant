/**
 * Preview Server Key Utilities
 * 
 * Re-exports from centralized redisKeyUtils.
 * Preview uses 4-part keys: org:user:project:feature
 */

import { 
  createPreviewKey, 
  parsePreviewKey,
  PreviewKeyComponents 
} from '../../../../../../infrastructure/state/redisKeyUtils';
import type { ServerKeyComponents } from '../types';

// Re-export with original names
export const createServerKey = createPreviewKey;

export function parseServerKey(serverKey: string): ServerKeyComponents {
  const parsed = parsePreviewKey(serverKey);
  return parsed || { tenantId: '', userId: '', projectId: '', feature: '' };
}

