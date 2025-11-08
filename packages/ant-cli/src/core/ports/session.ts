import { Session, SessionTurn, SessionArtifacts } from "../types";

/**
 * Job type for session management
 * Each job type has its own isolated session file
 */
export type JobType = 'design' | 'code' | 'learn';

/**
 * Session Port
 * 
 * Manages feature development sessions with turn-by-turn history.
 * Sessions are stored in the workspace directory structure:
 * workspace/{project}/{feature}/sessions/{job}.json
 * 
 * Each job type (design, code, learn) maintains its own independent session.
 * This prevents conflicts when switching between different job types.
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
   * @param job - Job type (design, code, or learn)
   * @returns Session object
   */
  load(project: string, feature: string, job: JobType): Promise<Session>;
  
  /**
   * Save the entire session
   * @param session - Complete session object
   * @param job - Job type (design, code, or learn)
   */
  save(session: Session, job: JobType): Promise<void>;
  
  /**
   * Add a new turn to the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @param turn - Turn data to add
   */
  addTurn(project: string, feature: string, job: JobType, turn: SessionTurn): Promise<void>;
  
  /**
   * Update session artifacts
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @param artifacts - Artifacts to merge
   */
  updateArtifacts(project: string, feature: string, job: JobType, artifacts: Partial<SessionArtifacts>): Promise<void>;
  
  /**
   * Get the last turn from the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @returns Last turn or null if session is empty
   */
  getLastTurn(project: string, feature: string, job: JobType): Promise<SessionTurn | null>;
  
  /**
   * Check if a session exists
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @returns True if session file exists
   */
  exists(project: string, feature: string, job: JobType): Promise<boolean>;
}

