import { Session } from '@/domain/models/session';
import { fetchSession } from '@/infrastructure/http/api';

/**
 * Loads a session from the API.
 * 
 * Note: Session updates are now handled by SSE (kanban events).
 * No polling needed - session changes are pushed from server.
 * 
 * @param projectId - The project ID to load
 * @returns The session data or null if not found
 */
export async function loadSession(projectId: string): Promise<Session | null> {
  return fetchSession(projectId);
}
