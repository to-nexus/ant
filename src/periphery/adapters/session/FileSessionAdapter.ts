import { SessionPort } from "../../../core/ports";
import { Session, SessionTurn, SessionArtifacts } from "../../../core/types";
import { parseSession, safeParseSession } from "../../../core/schemas/session.schema";
import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";

/**
 * File-based Session Adapter
 * 
 * Implements SessionPort using JSON files in the workspace directory.
 * 
 * File structure:
 * workspace/{project}/{feature}/session.json
 * 
 * Benefits:
 * - Human-readable JSON format
 * - Git version control
 * - Direct file access
 * - Easy backup and sharing
 * - AI can read directly
 */
export class FileSessionAdapter implements SessionPort {
  private workspaceRoot: string;
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Get the session file path
   */
  private getSessionPath(project: string, feature: string): string {
    return path.join(this.workspaceRoot, project, feature, "session.json");
  }
  
  /**
   * Ensure the session directory exists
   */
  private async ensureDirectory(project: string, feature: string): Promise<void> {
    const sessionDir = path.join(this.workspaceRoot, project, feature);
    await fs.mkdir(sessionDir, { recursive: true });
  }
  
  /**
   * Load an existing session or create a new one
   */
  async load(project: string, feature: string): Promise<Session> {
    const sessionPath = this.getSessionPath(project, feature);
    
    try {
      const content = await fs.readFile(sessionPath, "utf-8");
      const rawData = JSON.parse(content);
      
      // Validate and parse with zod
      const session = safeParseSession(rawData);
      if (!session) {
        console.warn(`⚠️  Session file validation failed: ${sessionPath}`);
        console.warn(`Creating new session due to invalid format`);
        
        // Backup corrupted file
        const backupPath = `${sessionPath}.corrupted.${Date.now()}`;
        await fs.copyFile(sessionPath, backupPath);
        console.warn(`Corrupted file backed up to: ${backupPath}`);
        
        // Return new session
        return this.createNewSession(project, feature);
      }
      
      return session;
    } catch (error: any) {
      // If file doesn't exist, create a new session
      if (error.code === "ENOENT") {
        return this.createNewSession(project, feature);
      }
      throw error;
    }
  }
  
  /**
   * Create a new session with UUID
   */
  private createNewSession(project: string, feature: string): Session {
    return {
      sessionId: randomUUID(),
      project,
      feature,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
      artifacts: {}
    };
  }
  
  /**
   * Save the entire session
   */
  async save(session: Session): Promise<void> {
    await this.ensureDirectory(session.project, session.feature);
    const sessionPath = this.getSessionPath(session.project, session.feature);
    
    // Update timestamp
    session.updatedAt = new Date().toISOString();
    
    // Validate before saving
    try {
      parseSession(session); // Will throw if invalid
    } catch (error) {
      console.error(`❌ Session validation failed before save:`, error);
      throw new Error(`Invalid session data: ${error}`);
    }
    
    // Write with pretty formatting for human readability
    const content = JSON.stringify(session, null, 2);
    await fs.writeFile(sessionPath, content, "utf-8");
  }
  
  /**
   * Add a new turn to the session
   */
  async addTurn(project: string, feature: string, turn: SessionTurn): Promise<void> {
    const session = await this.load(project, feature);
    
    // Set turn ID if not provided
    if (!turn.turnId) {
      turn.turnId = session.turns.length + 1;
    }
    
    // Set timestamp if not provided
    if (!turn.timestamp) {
      turn.timestamp = new Date().toISOString();
    }
    
    session.turns.push(turn);
    await this.save(session);
  }
  
  /**
   * Update session artifacts
   */
  async updateArtifacts(
    project: string,
    feature: string,
    artifacts: Partial<SessionArtifacts>
  ): Promise<void> {
    const session = await this.load(project, feature);
    session.artifacts = { ...session.artifacts, ...artifacts };
    await this.save(session);
  }
  
  /**
   * Get the last turn from the session
   */
  async getLastTurn(project: string, feature: string): Promise<SessionTurn | null> {
    const session = await this.load(project, feature);
    if (session.turns.length === 0) {
      return null;
    }
    return session.turns[session.turns.length - 1];
  }
  
  /**
   * Check if a session exists
   */
  async exists(project: string, feature: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(project, feature);
    try {
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }
}

