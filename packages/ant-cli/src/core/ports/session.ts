import { Session, SessionRun, SessionArtifacts, SessionState } from "../types";
import { SessionableJobType } from '@ant/shared';

/**
 * Session Port
 * 
 * Manages feature development sessions with run-by-run history.
 * Sessions are stored in the workspace directory structure:
 * workspace/{project}/{feature}/sessions/{agent}/{job}.json
 * 
 * Each sessionable job type (design, code, learn, planning) maintains its own session file.
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
   * @param job - Sessionable job type (design, code, learn, planning)
   * @returns Session object
   */
  load(project: string, feature: string, job: SessionableJobType): Promise<Session>;
  
  /**
   * Save the entire session
   * @param session - Complete session object
   * @param job - Sessionable job type
   */
  save(session: Session, job: SessionableJobType): Promise<void>;
  
  /**
   * Add a new run to the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @param run - Run data to add
   */
  addRun(project: string, feature: string, job: SessionableJobType, run: SessionRun): Promise<void>;
  
  /**
   * Update session artifacts
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @param artifacts - Artifacts to merge
   */
  updateArtifacts(project: string, feature: string, job: SessionableJobType, artifacts: Partial<SessionArtifacts> & { state?: Partial<SessionState> }): Promise<void>;
  
  /**
   * Get the last run from the session
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @returns Last run or null if session is empty
   */
  getLastRun(project: string, feature: string, job: SessionableJobType): Promise<SessionRun | null>;
  
  /**
   * Check if a session exists
   * @param project - Project name
   * @param feature - Feature name
   * @param job - Sessionable job type
   * @returns True if session file exists
   */
  exists(project: string, feature: string, job: SessionableJobType): Promise<boolean>;
}
