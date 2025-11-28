import { Request } from 'express';
import { UserContext } from '../../../../../core/types/user';

/**
 * Extract UserContext from Express Request
 * Priority:
 * 1. Query parameter (user-email) - for frontend API calls
 * 2. Auth middleware (req.user, req.organization) - for authenticated requests
 * 3. Fallback to 'local' - for local mode
 */
export function extractUserContext(req: Request): UserContext {
  // Priority 1: Query parameter (from frontend)
  const userEmailQuery = req.query['user-email'] as string | undefined;
  if (userEmailQuery) {
    const userId = userEmailQuery.split('@')[0];
    const domain = userEmailQuery.split('@')[1];
    return {
      userId,
      organizationId: domain,
      workspacePath: ''
    };
  }
  
  // Priority 2: Auth middleware
  if (req.user && req.organization) {
    return {
      userId: req.user.id,
      organizationId: req.organization.id,
      workspacePath: '' // Not used by WorkspaceResolver
    };
  }
  
  // Priority 3: Fallback for Local mode
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

