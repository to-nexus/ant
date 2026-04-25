import { UserContext } from '../types/user';

/**
 * File Tree Update Port
 * 
 * Port for notifying when file tree changes (for real-time UI updates)
 * Hexagonal Architecture: Core → Port ← Adapter (ExpressServerAdapter)
 */

export interface FileTreeUpdatePort {
  /**
   * Notify that the file tree has changed
   * @param projectId - Project identifier
   * @param featureName - Feature name
   * @param userContext - Optional user context for Cloud mode
   */
  notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: UserContext): Promise<void>;
}

