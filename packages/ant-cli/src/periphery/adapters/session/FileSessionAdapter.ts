import { SessionPort, FileTreeUpdatePort } from "../../../core/ports";
import { SessionableJobType } from '@ant/shared';
import * as crypto from "crypto";
import { Session, SessionRun, SessionArtifacts, SessionState } from "../../../core/types";
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
   */
  private getSessionPath(_project: string, _feature: string, job: SessionableJobType): string {
    return getSessionFilePath(this.featurePath, this.agent, job);
  }
  
  /**
   * Get or create a mutex for the given job type.
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
   * Load an existing session or create a new one.
   * Rejects legacy format (pre-rename files with "turns" field) with an explicit error.
   */
  async load(project: string, feature: string, job: SessionableJobType): Promise<Session> {
    const sessionPath = this.getSessionPath(project, feature, job);
    
    try {
      const content = await fs.readFile(sessionPath, "utf-8");
      
      if (!content || content.trim() === "") {
        console.log(`📝 Empty session file detected, creating new session`);
        return this.createNewSession(project, feature);
      }
      
      const rawData = JSON.parse(content);
      
      // Reject legacy format (pre-rename "turns" field)
      if (rawData.turns && !rawData.runs) {
        console.error(`❌ Legacy session format detected: ${sessionPath}`);
        console.error(`   This file uses the old "turns" field which is no longer supported.`);
        console.error(`   Please delete this file and restart: rm "${sessionPath}"`);
        throw new Error(
          `Legacy session format not supported. File "${sessionPath}" contains "turns" instead of "runs". ` +
          `Delete the file and retry.`
        );
      }
      
      const session = safeParseSession(rawData);
      if (!session) {
        console.warn(`⚠️  Session file validation failed: ${sessionPath}`);
        console.warn(`Creating new session due to invalid format`);
        
        try {
          await fs.unlink(sessionPath);
          console.log(`🗑️  Removed corrupted session file`);
        } catch (unlinkError) {
          // Ignore if file doesn't exist
        }
        
        return this.createNewSession(project, feature);
      }
      
      return session;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return this.createNewSession(project, feature);
      }
      
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
      runs: [],
      artifacts: {}
    };
  }
  
  /**
   * Save the entire session (atomic write: temp file + rename).
   */
  async save(session: Session, job: SessionableJobType): Promise<void> {
    await this.ensureDirectory(session.project, session.feature);
    const sessionPath = this.getSessionPath(session.project, session.feature, job);
    
    session.updatedAt = new Date().toISOString();
    
    try {
      parseSession(session);
    } catch (error) {
      console.error(`❌ Session validation failed before save:`, error);
      throw new Error(`Invalid session data: ${error}`);
    }
    
    const content = JSON.stringify(session, null, 2);
    const dir = path.dirname(sessionPath);
    const tmpPath = path.join(dir, `.${path.basename(sessionPath)}.${process.pid}.tmp`);
    
    try {
      await fs.writeFile(tmpPath, content, "utf-8");
      await fs.rename(tmpPath, sessionPath);
    } catch (err) {
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
    
    if (this.fileTreeUpdate) {
      this.fileTreeUpdate.notifyFileTreeUpdate(this.projectId, this.featureName);
    }
  }
  
  /**
   * Add a new run to the session (serialized with per-job lock)
   */
  async addRun(project: string, feature: string, job: SessionableJobType, run: SessionRun): Promise<void> {
    const lock = this.getFileLock(job);
    await lock.runExclusive(async () => {
      const session = await this.load(project, feature, job);
      
      if (!run.runId) {
        run.runId = session.runs.length + 1;
      }
      
      if (!run.timestamp) {
        run.timestamp = new Date().toISOString();
      }
      
      session.runs.push(run);
      await this.save(session, job);
    });
  }
  
  /**
   * Update session artifacts (serialized with per-job lock)
   */
  async updateArtifacts(
    project: string,
    feature: string,
    job: SessionableJobType,
    artifacts: Partial<SessionArtifacts> & { state?: Partial<SessionState> }
  ): Promise<void> {
    const lock = this.getFileLock(job);
    await lock.runExclusive(async () => {
      const session = await this.load(project, feature, job);
      
      const { state, ...actualArtifacts } = artifacts as any;
      
      session.artifacts = { ...session.artifacts, ...actualArtifacts };
      
      if (state !== undefined) {
        session.state = state;
      }
      
      await this.save(session, job);
    });
  }
  
  /**
   * Get the last run from the session
   */
  async getLastRun(project: string, feature: string, job: SessionableJobType): Promise<SessionRun | null> {
    const session = await this.load(project, feature, job);
    if (session.runs.length === 0) {
      return null;
    }
    return session.runs[session.runs.length - 1];
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
