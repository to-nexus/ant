import { UserContext } from '../types/user';

/**
 * Preview Update Port
 * 
 * Port for broadcasting preview-related state changes from Job Worker processes.
 * Used by detectEnvironment to notify the frontend of structureType immediately.
 * 
 * Hexagonal Architecture: Core → Port ← Adapter (PreviewBroadcaster)
 */

export type PreviewStructureType = 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';

export interface PreviewUpdatePort {
  /**
   * Broadcast detected structure type to frontend via SSE
   * Called from detectEnvironment node after environment analysis
   * 
   * @param projectId - Project identifier
   * @param featureName - Feature name  
   * @param structureType - Detected project structure type
   * @param userContext - Optional user context for Cloud mode
   */
  broadcastStructureType(
    projectId: string,
    featureName: string,
    structureType: PreviewStructureType,
    userContext?: UserContext
  ): void;
}
