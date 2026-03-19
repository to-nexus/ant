import { SessionPort, FileTreeUpdatePort } from "../../../core/ports";
import { SessionableJobType } from '@ant/shared';
import * as crypto from "crypto";
import { Session, SessionTurn, SessionArtifacts } from "../../../core/types";
import { parseSession, safeParseSession } from "../../../core/schemas/session.schema";
import * as fs from "fs/promises";
import * as path from "path";
import { getSessionFilePath, getSessionsDir } from "../../../core/utils/sessionPaths";

/**
 * Simple async mutex for serializing file I/O.
 * Prevents race conditions when multiple workers call updateArtifacts concurrently.
 */
class FileMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    // Acquire
    if (this.locked) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    } else {
      this.locked = true;
    }
    try {
      return await fn();
    } finally {
      // Release
      if (this.waitQueue.length > 0) {
        const next = this.waitQueue.shift()!;
        next();
      } else {
        this.locked = false;
      }
    }
  }
}

/**
 * File-based Session Adapter
 * 
 * Implements SessionPort using JSON files in the workspace directory.
 * 
 * File structure:
 * {featurePath}/sessions/{agent}/{job}.json
 * 
 * Each sessionable job type (design, code, learn, planning) maintains its own session file
 * under its owning agent's subdirectory, preventing conflicts across agents and jobs.
 * 
 * Benefits:
 * - Human-readable JSON format
 * - Git version control
 * - Direct file access
 * - Easy backup and sharing
 * - AI can read directly
 * - Agent + Job isolation
 */
export class FileSessionAdapter implements SessionPort {
  private featurePath: string;
  private agent: string;
  readonly projectId: string;
  readonly featureName: string;
  private fileTreeUpdate?: FileTreeUpdatePort;
  
  /** Per-job file lock to prevent concurrent read-modify-write race conditions */
  private readonly fileLocks = new Map<string, FileMutex>();
  
  constructor(featurePath: string, agent: string, projectId?: string, featureName?: string, fileTreeUpdate?: FileTreeUpdatePort) {
    this.featurePath = featurePath;
    this.agent = agent;
    
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
   * Get the session file path (agent-nested)
   * 
   * Uses this.featurePath directly — the constructor already receives the correct
   * resolved path. Re-resolving via workspaceResolver caused path mismatches
   * (e.g., USER_ID vs ANT_USER_ID env var differences) leading to silent write failures.
   */
  private getSessionPath(_project: string, _feature: string, job: SessionableJobType): string {
    return getSessionFilePath(this.featurePath, this.agent, job);
  }
  
  /**
   * Get or create a mutex for the given job type.
   * Serializes all file operations for the same session file.
   */
  private getFileLock(job: SessionableJobType): FileMutex {
    if (!this.fileLocks.has(job)) {
      this.fileLocks.set(job, new FileMutex());
    }
    return this.fileLocks.get(job)!;
  }
  
  /**
   * Ensure the sessions directory exists
   */
  private async ensureDirectory(project: string, feature: string): Promise<void> {
    const agentDir = getSessionsDir(this.featurePath, this.agent);
    await fs.mkdir(agentDir, { recursive: true });
  }
  
  /**
   * Load an existing session or create a new one
   */
  async load(project: string, feature: string, job: SessionableJobType): Promise<Session> {
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
      sessionId: crypto.randomUUID(),
      project,
      feature,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turns: [],
      artifacts: {}
    };
  }
  
  /**
   * Save the entire session (atomic write: temp file + rename).
   * 
   * Atomic write prevents partial/corrupt JSON when process is killed mid-write.
   * The rename operation is atomic on POSIX systems when src and dest are on the
   * same filesystem, ensuring readers always see a complete JSON file.
   */
  async save(session: Session, job: SessionableJobType): Promise<void> {
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
    
    // ✅ Atomic write: write to temp file in same directory, then rename
    const content = JSON.stringify(session, null, 2);
    const dir = path.dirname(sessionPath);
    const tmpPath = path.join(dir, `.${path.basename(sessionPath)}.${process.pid}.tmp`);
    
    try {
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, sessionPath);
    } catch (err) {
      // Cleanup temp file on failure
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
    
    // ✅ Notify file tree update
    if (this.fileTreeUpdate) {
      this.fileTreeUpdate.notifyFileTreeUpdate(this.projectId, this.featureName);
    }
  }
  
  /**
   * Add a new turn to the session (serialized with per-job lock)
   */
  async addTurn(project: string, feature: string, job: SessionableJobType, turn: SessionTurn): Promise<void> {
    const lock = this.getFileLock(job);
    await lock.runExclusive(async () => {
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
    });
  }
  
  /**
   * Update session artifacts (serialized with per-job lock)
   * 
   * ✅ ENHANCED: Also handles 'state' field for resuming after recursion limit
   * If artifacts contains 'state', it will be saved to session.state
   * 
   * The per-job lock prevents race conditions when multiple workers
   * call saveCheckpoint → onCheckpoint → updateArtifacts concurrently.
   */
  async updateArtifacts(
    project: string,
    feature: string,
    job: SessionableJobType,
    artifacts: Partial<SessionArtifacts> & { state?: any }
  ): Promise<void> {
    const lock = this.getFileLock(job);
    await lock.runExclusive(async () => {
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
    });
  }
  
  /**
   * Get the last turn from the session
   */
  async getLastTurn(project: string, feature: string, job: SessionableJobType): Promise<SessionTurn | null> {
    const session = await this.load(project, feature, job);
    if (session.turns.length === 0) {
      return null;
    }
    return session.turns[session.turns.length - 1];
  }
  
  /**
   * Check if a session exists
   */
  async exists(project: string, feature: string, job: SessionableJobType): Promise<boolean> {
    const sessionPath = this.getSessionPath(project, feature, job);
    try {
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }
}

