/**
 * Chat schema helpers — Redis session key derivation.
 *
 * The pre-§5 ChatSession/ChatMessage scratchpad has been retired (Phase
 * 9). The remaining helpers are the session-key formatters used by the
 * worker's `LLMResponseService` and the HTTP-side `ChatService` to
 * scope TURN_BUFFER + Pub/Sub keys per tenant.
 */

import type { UserContext } from '../types/user';

/**
 * Get Redis session key for a project/feature.
 * Format: `org:user:projectId/featureName`
 */
export function getSessionKey(
  projectId: string,
  featureName: string,
  userContext?: UserContext,
): string {
  if (userContext?.organizationId && userContext?.userId) {
    return `${userContext.organizationId}:${userContext.userId}:${projectId}/${featureName}`;
  }
  return `local:local:${projectId}/${featureName}`;
}

/**
 * Get simple key for local cache (without user context).
 * Format: `projectId/featureName`
 */
export function getSimpleKey(projectId: string, featureName: string): string {
  return `${projectId}/${featureName}`;
}
