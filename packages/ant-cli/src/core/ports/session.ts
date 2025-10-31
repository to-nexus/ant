import { Session, SessionTurn, SessionArtifacts } from "../types";

/**
 * Session Port
 * 
 * Manages feature development sessions with turn-by-turn history.
 * Sessions are stored in the workspace directory structure:
 * workspace/{project}/{feature}/session.json
 * 
 * This port follows the Hexagonal Architecture pattern:
 * - Interface (Port) defined in core
 * - Implementation (Adapter) in periphery
 */
export interface SessionPort {
  /**
   * Load an existing session or create a new one
   * @param project - Project name
   * @param feature - Feature name
   * @returns Session object
   */
  load(project: string, feature: string): Promise<Session>;
  
  /**
   * Save the entire session
   * @param session - Complete session object
   */
  save(session: Session): Promise<void>;
  
  /**
   * Add a new turn to the session
   * @param project - Project name
   * @param feature - Feature name
   * @param turn - Turn data to add
   */
  addTurn(project: string, feature: string, turn: SessionTurn): Promise<void>;
  
  /**
   * Update session artifacts
   * @param project - Project name
   * @param feature - Feature name
   * @param artifacts - Artifacts to merge
   */
  updateArtifacts(project: string, feature: string, artifacts: Partial<SessionArtifacts>): Promise<void>;
  
  /**
   * Get the last turn from the session
   * @param project - Project name
   * @param feature - Feature name
   * @returns Last turn or null if session is empty
   */
  getLastTurn(project: string, feature: string): Promise<SessionTurn | null>;
  
  /**
   * Check if a session exists
   * @param project - Project name
   * @param feature - Feature name
   * @returns True if session file exists
   */
  exists(project: string, feature: string): Promise<boolean>;
}

