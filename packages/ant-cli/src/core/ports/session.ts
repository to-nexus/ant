import { Session, SessionTurn, SessionArtifacts } from "../types";
import { DecomposableJobType } from '../types/task';

/**
 * Session Port
 * 
 * Manages feature development sessions with turn-by-turn history.
 * Sessions are stored in the workspace directory structure:
 * workspace/{project}/{feature}/sessions/{job}.json
 * 
 * Each decomposable job type (design, code, learn) maintains its own independent session.
 * Ask jobs don't have sessions.
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
  load(project: string, feature: string, job: DecomposableJobType): Promise<Session>;
  
  /**
   * Save the entire session
   * @param session - Complete session object
   * @param job - Job type (design, code, or learn)
   */
  save(session: Session, job: DecomposableJobType): Promise<void>;
  
  /**
   * Add a new turn to the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @param turn - Turn data to add
   */
  addTurn(project: string, feature: string, job: DecomposableJobType, turn: SessionTurn): Promise<void>;
  
  /**
   * Update session artifacts
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @param artifacts - Artifacts to merge
   */
  updateArtifacts(project: string, feature: string, job: DecomposableJobType, artifacts: Partial<SessionArtifacts>): Promise<void>;
  
  /**
   * Get the last turn from the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @returns Last turn or null if session is empty
   */
  getLastTurn(project: string, feature: string, job: DecomposableJobType): Promise<SessionTurn | null>;
  
  /**
   * Check if a session exists
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Job type (design, code, or learn)
   * @returns True if session file exists
   */
  exists(project: string, feature: string, job: DecomposableJobType): Promise<boolean>;
}
