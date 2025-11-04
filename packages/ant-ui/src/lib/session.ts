import { Session } from '@/types/session';
import { fetchSession } from '@/lib/api';

/**
 * Watches a session by polling the API every 2 seconds.
 * Calls the callback only when session data actually changes.
 * 
 * @param projectId - The project ID to watch
 * @param callback - Called when session data changes (null when deleted)
 * @returns Object with close() method to stop watching
 */
export function watchSession(
  projectId: string,
  callback: (sessionData: Session | null) => void
): { close: () => void } {
  let previousSession: Session | null = null;
  let intervalId: number | null = null;

  const pollSession = async () => {
    try {
      const currentSession = await fetchSession(projectId);
      
      console.log('[watchSession] Polled session:', {
        projectId,
        currentSession,
        isNull: currentSession === null,
      });
      
      const currentJson = JSON.stringify(currentSession);
      const previousJson = JSON.stringify(previousSession);
      
      if (currentJson !== previousJson) {
        console.log('[watchSession] Session changed, calling callback with:', currentSession);
        previousSession = currentSession;
        // null이어도 callback 호출 (session 삭제 감지)
        callback(currentSession);
      } else {
        console.log('[watchSession] Session unchanged, skipping callback');
      }
    } catch (error) {
      console.error('Error polling session:', error);
    }
  };

  pollSession();
  
  intervalId = window.setInterval(pollSession, 2000);

  return {
    close: () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    }
  };
}

/**
 * Loads a session from the API.
 * 
 * @param projectId - The project ID to load
 * @returns The session data or null if not found
 */
export async function loadSession(projectId: string): Promise<Session | null> {
  return fetchSession(projectId);
}