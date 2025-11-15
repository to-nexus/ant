import { Request } from 'express';
import { UserContext } from '../../../../../core/types/user';

/**
 * Extract UserContext from Express Request
 * Uses optional user and organization from req (set by auth middleware)
 */
export function extractUserContext(req: Request): UserContext {
  if (req.user && req.organization) {
    return {
      userId: req.user.id,
      organizationId: req.organization.id,
      workspacePath: '' // Not used by WorkspaceResolver
    };
  }
  
  // Fallback for Local mode
  return {
    userId: 'local',
    organizationId: 'local',
    workspacePath: ''
  };
}

/**
 * Check if request has authenticated user context
 */
export function hasUserContext(req: Request): boolean {
  return !!(req.user && req.organization);
}

