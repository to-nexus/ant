import { UserContext } from '../types/user';

/**
 * Preview Update Port
 * 
 * Port for broadcasting preview-related state changes from Job Worker processes.
 * Used by decompose node to notify the frontend of structureType and projectProfile.
 * 
 * Hexagonal Architecture: Core → Port ← Adapter (PreviewBroadcaster)
 */

export type PreviewStructureType = 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';

export interface PreviewUpdatePort {
  /**
   * Broadcast detected structure type and project profile to frontend via SSE
   * Called from decompose node after environment/profile analysis
   * 
   * @param projectId - Project identifier
   * @param featureName - Feature name  
   * @param structureType - Detected project structure type
   * @param userContext - Optional user context for Cloud mode
   * @param projectProfile - Detected language/framework profile
   */
  broadcastStructureType(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext?: UserContext,
    projectProfile?: { language: string; framework?: string }
  ): void;
}
