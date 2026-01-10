import { SessionPort, JobType, FileTreeUpdatePort } from "../../../core/ports";
import { Session, SessionTurn, SessionArtifacts } from "../../../core/types";
import { parseSession, safeParseSession } from "../../../core/schemas/session.schema";
import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { WorkspaceResolver } from "../../../infrastructure/workspace/WorkspaceResolver";

/**
 * File-based Session Adapter
 * 
 * Implements SessionPort using JSON files in the workspace directory.
 * 
 * File structure:
 * {featurePath}/sessions/{job}.json
 * 
 * Each job type (design, code, learn) maintains its own session file,
 * preventing conflicts when switching between different job types.
 * 
 * Benefits:
 * - Human-readable JSON format
 * - Git version control
 * - Direct file access
 * - Easy backup and sharing
 * - AI can read directly
 * - Job isolation
 */
export class FileSessionAdapter implements SessionPort {
  private featurePath: string;
  private workspaceResolver: WorkspaceResolver;
  private projectId: string;
  private featureName: string;
  private fileTreeUpdate?: FileTreeUpdatePort;
  
  constructor(featurePath: string, projectId?: string, featureName?: string, fileTreeUpdate?: FileTreeUpdatePort) {
    this.featurePath = featurePath;
    // WorkspaceResolver는 외부에서 주입받도록 변경 필요
    const mode = process.env.ANT_SERVER_MODE === 'cloud' ? 'cloud' : 'local';
    const { WorkspacePathResolver, CloudWorkspaceResolver, LocalWorkspaceResolver } = require('../../../infrastructure/workspace/WorkspaceResolver');
    const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
    this.workspaceResolver = mode === 'cloud'
      ? new CloudWorkspaceResolver(workspacesPath)
      : new LocalWorkspaceResolver(workspacesPath);
    
    // ✅ Extract projectId and featureName from featurePath if not provided
    if (projectId && featureName) {
      this.projectId = projectId;
      this.featureName = featureName;
    } else {
      const parts = featurePath.split(path.sep);
      const featuresIdx = parts.lastIndexOf('features');
      this.projectId = featuresIdx > 0 ? parts[featuresIdx - 1] : 'unknown';
      this.featureName = featuresIdx >= 0 && featuresIdx + 1 < parts.length ? parts[featuresIdx + 1] : 'unknown';
    }
    
    this.fileTreeUpdate = fileTreeUpdate;
  }
  
  /**
   * Get the session file path
   */
  private getSessionPath(project: string, feature: string, job: JobType): string {
    // featurePath는 WorkspaceResolver로 생성
    if (!project || !feature) {
      throw new Error('getSessionPath: project and feature must be provided');
    }
    // context는 최소한 userId, organizationId, workspacePath가 필요함
    const context = {
      userId: process.env.USER_ID || 'probe',
      organizationId: process.env.ORG_ID || 'to.nexus',
      workspacePath: ''
    };
    const featurePath = this.workspaceResolver.getFeaturePath(context, project, feature);
    return path.join(featurePath, "sessions", `${job}.json`);
  }
  
  /**
   * Ensure the sessions directory exists
   */
  private async ensureDirectory(project: string, feature: string): Promise<void> {
    const sessionsDir = path.join(this.featurePath, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
  }
  
  /**
   * Load an existing session or create a new one
   */
  async load(project: string, feature: string, job: JobType): Promise<Session> {
    const sessionPath = this.getSessionPath(project, feature, job);
    
    try {
      const content = await fs.readFile(sessionPath, "utf-8");
      
      // ✅ Handle empty file (0 bytes) - treat as new session
      if (!content || content.trim() === "") {
        console.log(`📝 Empty session file detected, creating new session`);
        return this.createNewSession(project, feature);
      }
      
      const rawData = JSON.parse(content);
      
      // Validate and parse with zod
      const session = safeParseSession(rawData);
      if (!session) {
        console.warn(`⚠️  Session file validation failed: ${sessionPath}`);
        console.warn(`Creating new session due to invalid format`);
        
        // Delete corrupted file (no backup needed)
        try {
          await fs.unlink(sessionPath);
          console.log(`🗑️  Removed corrupted session file`);
        } catch (unlinkError) {
          // Ignore if file doesn't exist
        }
        
        // Return new session
        return this.createNewSession(project, feature);
      }
      
      return session;
    } catch (error: any) {
      // If file doesn't exist, create a new session
      if (error.code === "ENOENT") {
        return this.createNewSession(project, feature);
      }
      
      // ✅ Handle JSON parse errors - treat as corrupted
      if (error instanceof SyntaxError) {
        console.warn(`⚠️  Session file has invalid JSON: ${sessionPath}`);
        console.warn(`Error: ${error.message}`);
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
  async save(session: Session, job: JobType): Promise<void> {
    await this.ensureDirectory(session.project, session.feature);
    const sessionPath = this.getSessionPath(session.project, session.feature, job);
    
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
    
    // ✅ Notify file tree update
    if (this.fileTreeUpdate) {
      this.fileTreeUpdate.notifyFileTreeUpdate(this.projectId, this.featureName);
    }
  }
  
  /**
   * Add a new turn to the session
   */
  async addTurn(project: string, feature: string, job: JobType, turn: SessionTurn): Promise<void> {
    const session = await this.load(project, feature, job);
    
    // Set turn ID if not provided
    if (!turn.turnId) {
      turn.turnId = session.turns.length + 1;
    }
    
    // Set timestamp if not provided
    if (!turn.timestamp) {
      turn.timestamp = new Date().toISOString();
    }
    
    session.turns.push(turn);
    await this.save(session, job);
  }
  
  /**
   * Update session artifacts
   * 
   * ✅ ENHANCED: Also handles 'state' field for resuming after recursion limit
   * If artifacts contains 'state', it will be saved to session.state
   */
  async updateArtifacts(
    project: string,
    feature: string,
    job: JobType,
    artifacts: Partial<SessionArtifacts> & { state?: any }
  ): Promise<void> {
    const session = await this.load(project, feature, job);
    
    // Extract state if provided (it's not part of artifacts, but a top-level session field)
    const { state, ...actualArtifacts } = artifacts as any;
    
    // Update artifacts
    session.artifacts = { ...session.artifacts, ...actualArtifacts };
    
    // ✅ Update state if provided (for resuming after recursion limit)
    if (state !== undefined) {
      session.state = state;
    }
    
    await this.save(session, job);
  }
  
  /**
   * Get the last turn from the session
   */
  async getLastTurn(project: string, feature: string, job: JobType): Promise<SessionTurn | null> {
    const session = await this.load(project, feature, job);
    if (session.turns.length === 0) {
      return null;
    }
    return session.turns[session.turns.length - 1];
  }
  
  /**
   * Check if a session exists
   */
  async exists(project: string, feature: string, job: JobType): Promise<boolean> {
    const sessionPath = this.getSessionPath(project, feature, job);
    try {
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }
}

