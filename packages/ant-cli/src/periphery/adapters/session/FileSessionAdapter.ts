import { SessionPort, FileTreeUpdatePort } from "../../../core/ports";
import type {
  SessionableJobType,
  FeatureLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
  FeatureBoundaryLine,
  TraceLine,
  TraceUserTurnLine,
  LogJobType,
} from '@ant/shared';
import * as crypto from "crypto";
import { Session, SessionRun, SessionArtifacts, SessionState } from "../../../core/types";
import { parseSession, safeParseSession } from "../../../core/schemas/session.schema";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getSessionFilePath,
  getSessionsDir,
  getFeatureJsonlPath,
  getTraceJsonlPath,
} from "../../../core/utils/sessionPaths";

/**
 * Legacy complexity literal fallback.
 *
 * Pre-5-tier-rename `feature.jsonl` lines carry `complexity: 'todo'`. The
 * SSOT type ({@link import('@ant/shared').Complexity}) no longer includes
 * `'todo'`; readers therefore upgrade the literal on the fly so older
 * workspaces keep resuming. Writers emit `'task'` only — no file rewrite
 * occurs (append-only invariant preserved).
 */
let legacyComplexityLoggedOnce = false;
function normalizeLegacyComplexity<T extends { complexity?: string }>(line: T): T {
  if ((line as any).complexity === 'todo') {
    if (!legacyComplexityLoggedOnce) {
      legacyComplexityLoggedOnce = true;
      console.debug(
        "📦 [FileSessionAdapter] legacy complexity literal migrated on read: 'todo' → 'task' (on-disk unchanged)",
      );
    }
    return { ...line, complexity: 'task' } as T;
  }
  return line;
}

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

  // ═══════════════════════════════════════════════════════════════════════
  // feature.jsonl / trace.jsonl — context & UI log (append-only JSONL)
  // ═══════════════════════════════════════════════════════════════════════

  /** Shared mutex for JSONL file writes (per-file) */
  private readonly jsonlLocks = new Map<string, FileMutex>();

  private getJsonlLock(filePath: string): FileMutex {
    if (!this.jsonlLocks.has(filePath)) {
      this.jsonlLocks.set(filePath, new FileMutex());
    }
    return this.jsonlLocks.get(filePath)!;
  }

  /**
   * Append a line to feature.jsonl or trace.jsonl (generic).
   * Append-only. JSON.stringify(line) + '\n'.
   */
  async appendLine(file: 'feature' | 'trace', line: FeatureLine | TraceLine): Promise<void> {
    const filePath = file === 'feature'
      ? getFeatureJsonlPath(this.featurePath)
      : getTraceJsonlPath(this.featurePath);

    const lock = this.getJsonlLock(filePath);
    await lock.runExclusive(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const content = JSON.stringify(line) + '\n';
      await fs.appendFile(filePath, content, 'utf-8');
    });
  }

  /**
   * Append a user_turn to feature.jsonl (context SSOT) and trace.jsonl (UI).
   *
   * jobType='ask'|'inline-ask'인 경우 skipFeature=true 필요 (호출자 책임) —
   * ask 대화는 맥락 대상 아니므로 feature.jsonl에 기록하지 않음.
   *
   * trace.jsonl에는 항상 기록 (UI 연속성).
   *
   * **Atomicity contract**: feature.jsonl and trace.jsonl are append-only and
   * each has its own per-file lock, but the two appends are NOT atomic across
   * a process crash between them. The invariant enforced here is:
   *
   *   feature.jsonl is the context SSOT → it MUST succeed or throw.
   *   trace.jsonl is UI-only → if it fails AFTER feature succeeded, we log
   *   and swallow. The job continues with a correct context record; the UI
   *   just misses one copy of the turn (the feature line still carries the
   *   original directive).
   *
   * The earlier design collapsed the feature line on trace failure as a
   * rollback step, but because the orchestrator catches recordUserTurn
   * failures with `.catch(console.warn)` and continues, that rollback left
   * the job running with a collapsed user_turn → later user_turn_meta /
   * breadcrumb lines became orphans referring to a collapsed turnId. The
   * current behaviour avoids that inconsistency.
   */
  async appendUserTurn(
    line: FeatureUserTurnLine,
    options: { skipFeature?: boolean } = {},
  ): Promise<void> {
    // 1. feature.jsonl에 append (skipFeature가 true면 건너뜀). 실패 시 throw.
    if (!options.skipFeature) {
      await this.appendLine('feature', line);
    }

    // 2. trace.jsonl에 사본 append (항상). Failure here does NOT abort the
    //    feature-side record — feature.jsonl is the context SSOT.
    const sourceRef = options.skipFeature
      ? 'ask-only'
      : `feature.jsonl#${line.turnId}`;
    const traceCopy: TraceUserTurnLine = {
      type: 'user_turn',
      ts: line.ts,
      jobId: line.jobId,
      turnId: line.turnId,
      jobType: line.jobType,
      text: line.text,
      sourceRef,
    };
    try {
      await this.appendLine('trace', traceCopy);
    } catch (traceErr) {
      // For ask/inline-ask skipFeature=true, feature was never written, so the
      // turn is effectively lost for both context AND UI — surface the error.
      if (options.skipFeature) throw traceErr;
      // Otherwise: feature.jsonl already carries the authoritative record.
      // Log and continue — the UI will be missing one turn copy but the
      // context pipeline (resolve → plan/direct) remains coherent.
      console.warn(
        `[FileSessionAdapter] trace.jsonl append failed for turnId=${line.turnId}; ` +
          `feature.jsonl record is intact. UI may be missing this turn copy.`,
        traceErr,
      );
    }
  }

  /**
   * Append user_turn_meta patch line (complexity/decidedBy/reason).
   * 
   * Decompose 판정 결과를 기록. resolve가 로드 시 user_turn과 turnId 기준 병합.
   */
  async appendUserTurnMeta(line: FeatureUserTurnMetaLine): Promise<void> {
    await this.appendLine('feature', line);
  }

  /**
   * Append a breadcrumb line to feature.jsonl.
   */
  async appendBreadcrumb(line: FeatureBreadcrumbLine): Promise<void> {
    await this.appendLine('feature', line);
  }

  /**
   * Append a boundary line to feature.jsonl + collapse all user_turn/user_turn_meta
   * lines before this boundary.
   * 
   * This is the main Collapse mechanism (§4.2 primary compression).
   */
  async appendBoundary(line: FeatureBoundaryLine): Promise<void> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    const lock = this.getJsonlLock(filePath);
    await lock.runExclusive(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // 1. Collapse prior user_turn/user_turn_meta lines
      await this.collapseBeforeBoundaryInternal(filePath, line.ts);
      // 2. Append the boundary line itself
      const content = JSON.stringify(line) + '\n';
      await fs.appendFile(filePath, content, 'utf-8');
    });
  }

  /**
   * Read all lines of a JSONL file (returns parsed objects).
   * Safe against partial writes (skips unparseable lines with warning).
   */
  private async readJsonlLines<T>(filePath: string): Promise<T[]> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim() !== '');
      const parsed: T[] = [];
      for (const l of lines) {
        try {
          parsed.push(JSON.parse(l));
        } catch {
          console.warn(`[FileSessionAdapter] Skipping malformed JSONL line in ${filePath}`);
        }
      }
      return parsed;
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Load feature.jsonl lines since the latest boundary.
   * 
   * resolve가 프롬프트 주입용으로 호출.
   * 
   * Returns T2(user_turn, user_turn_meta) after latest boundary, excluding collapsed lines,
   * + ALL T3(breadcrumb) lines regardless of boundary (T3는 반영구).
   */
  async loadSinceBoundary(): Promise<{
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
    breadcrumbs: FeatureBreadcrumbLine[];
  }> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<FeatureLine>(filePath);

    // Find index of latest boundary
    let latestBoundaryIdx = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].type === 'boundary') {
        latestBoundaryIdx = i;
        break;
      }
    }

    const userTurns: FeatureUserTurnLine[] = [];
    const userTurnMetas: FeatureUserTurnMetaLine[] = [];
    const breadcrumbs: FeatureBreadcrumbLine[] = [];

    for (let i = 0; i < all.length; i++) {
      const line = all[i];
      if (line.collapsed) continue;

      if (line.type === 'breadcrumb') {
        // Breadcrumbs는 boundary 무관하게 모두 수집
        breadcrumbs.push(line);
        continue;
      }
      // user_turn / user_turn_meta만 boundary 이후 체크
      if (i <= latestBoundaryIdx) continue;
      if (line.type === 'user_turn') {
        userTurns.push(line);
      } else if (line.type === 'user_turn_meta') {
        userTurnMetas.push(normalizeLegacyComplexity(line));
      }
    }

    return { userTurns, userTurnMetas, breadcrumbs };
  }

  /**
   * Load trace.jsonl lines grouped by turnId.
   * UI용. 특정 turn의 이벤트 블록을 조회.
   */
  async loadTraceByTurnIds(turnIds: string[]): Promise<TraceLine[]> {
    const filePath = getTraceJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<TraceLine>(filePath);
    const turnSet = new Set(turnIds);
    return all.filter(l => !l.collapsed && turnSet.has(l.turnId));
  }

  /**
   * Load trace.jsonl lines filtered by jobType (UI filtering).
   */
  async loadTraceByJobType(jobTypes: LogJobType[]): Promise<TraceLine[]> {
    const filePath = getTraceJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<TraceLine>(filePath);
    const jobTypeSet = new Set(jobTypes);
    return all.filter(l => !l.collapsed && jobTypeSet.has(l.jobType));
  }

  /**
   * Load ALL trace.jsonl lines (UI initial load).
   * Supports optional sinceTs (ISO 8601) and jobTypes filters.
   * Collapsed lines are excluded.
   */
  async loadAllTrace(opts: { sinceTs?: string; jobTypes?: LogJobType[] } = {}): Promise<TraceLine[]> {
    const filePath = getTraceJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<TraceLine>(filePath);
    const jobTypeSet = opts.jobTypes && opts.jobTypes.length > 0 ? new Set(opts.jobTypes) : null;
    const sinceTs = opts.sinceTs;
    return all.filter(l => {
      if (l.collapsed) return false;
      if (sinceTs && l.ts <= sinceTs) return false;
      if (jobTypeSet && !jobTypeSet.has(l.jobType)) return false;
      return true;
    });
  }

  /**
   * Load ALL breadcrumb lines from feature.jsonl (UI timeline).
   * Collapsed lines are excluded. Order preserved (append order = chronological).
   */
  async loadAllBreadcrumbs(): Promise<FeatureBreadcrumbLine[]> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<FeatureLine>(filePath);
    const out: FeatureBreadcrumbLine[] = [];
    for (const line of all) {
      if (line.type === 'breadcrumb' && !line.collapsed) {
        out.push(line);
      }
    }
    return out;
  }

  /**
   * Load ALL user_turn and user_turn_meta lines from feature.jsonl
   * (UI tier badge — §18 `tier_ui_badge`).
   *
   * Unlike `loadSinceBoundary`, this ignores the boundary cursor — the UI
   * tier badge needs to render mode/complexity/decidedBy/reason for every
   * non-collapsed turn, including those that survived the latest Hard Reset
   * but are still visible in the trace.
   *
   * Collapsed lines are excluded. Order preserved (append order).
   */
  async loadFeatureTurnMeta(): Promise<{
    userTurns: FeatureUserTurnLine[];
    userTurnMetas: FeatureUserTurnMetaLine[];
  }> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<FeatureLine>(filePath);
    const userTurns: FeatureUserTurnLine[] = [];
    const userTurnMetas: FeatureUserTurnMetaLine[] = [];
    for (const line of all) {
      if (line.collapsed) continue;
      if (line.type === 'user_turn') userTurns.push(line);
      else if (line.type === 'user_turn_meta') userTurnMetas.push(normalizeLegacyComplexity(line));
    }
    return { userTurns, userTurnMetas };
  }

  /**
   * Collapse a specific turnId in both feature.jsonl and trace.jsonl.
   * 
   * Used by Hard Reset (everything) or selective invalidation.
   */
  async collapseTurn(turnId: string): Promise<void> {
    await Promise.all([
      this.collapseTurnInFile(getFeatureJsonlPath(this.featurePath), turnId),
      this.collapseTurnInFile(getTraceJsonlPath(this.featurePath), turnId),
    ]);
  }

  /**
   * Collapse ALL lines in both files (Hard Reset).
   * Also appends a boundary line to feature.jsonl.
   *
   * `reason='user_reset'` (default call path from §17 Hard Reset) marks the
   * boundary with the agent-agnostic `jobType: 'reset'` literal so UI /
   * analytics can distinguish it from ordinary `auto_job_complete_todo`
   * boundaries. Callers invoking this method for a job-scoped collapse may
   * pass an explicit `jobType` override.
   */
  async collapseAll(
    reason: 'user_reset' | string,
    jobId: string,
    turnId: string,
    jobType?: LogJobType | 'reset',
  ): Promise<void> {
    await Promise.all([
      this.collapseAllInFile(getFeatureJsonlPath(this.featurePath)),
      this.collapseAllInFile(getTraceJsonlPath(this.featurePath)),
    ]);
    // Append boundary marker AFTER collapsing existing lines. Default the
    // jobType to the agent-agnostic `'reset'` literal unless the caller
    // explicitly wants to label the boundary with a concrete JobType (e.g.
    // during a targeted per-job collapse that should appear as `code`).
    const resolvedJobType: LogJobType | 'reset' = jobType ?? 'reset';
    const boundary: FeatureBoundaryLine = {
      type: 'boundary',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType: resolvedJobType,
      reason,
    };
    await this.appendLine('feature', boundary);
  }

  // ───── Private JSONL helpers ─────

  private async collapseTurnInFile(filePath: string, turnId: string): Promise<void> {
    const lock = this.getJsonlLock(filePath);
    await lock.runExclusive(async () => {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      const lines = content.split('\n');
      const newLines = lines.map(l => {
        if (!l.trim()) return l;
        try {
          const obj = JSON.parse(l);
          if (obj.turnId === turnId && !obj.collapsed) {
            obj.collapsed = true;
            return JSON.stringify(obj);
          }
          return l;
        } catch {
          return l;
        }
      });
      await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
    });
  }

  private async collapseAllInFile(filePath: string): Promise<void> {
    const lock = this.getJsonlLock(filePath);
    await lock.runExclusive(async () => {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (err: any) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      const lines = content.split('\n');
      const newLines = lines.map(l => {
        if (!l.trim()) return l;
        try {
          const obj = JSON.parse(l);
          if (!obj.collapsed) {
            obj.collapsed = true;
            return JSON.stringify(obj);
          }
          return l;
        } catch {
          return l;
        }
      });
      await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
    });
  }

  /**
   * Internal: collapse user_turn/user_turn_meta lines with ts < boundaryTs.
   * Must be called inside a lock (appendBoundary handles locking).
   */
  private async collapseBeforeBoundaryInternal(filePath: string, boundaryTs: string): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    const lines = content.split('\n');
    const newLines = lines.map(l => {
      if (!l.trim()) return l;
      try {
        const obj = JSON.parse(l);
        // Collapse only user_turn / user_turn_meta before this boundary timestamp
        if (
          (obj.type === 'user_turn' || obj.type === 'user_turn_meta') &&
          !obj.collapsed &&
          obj.ts < boundaryTs
        ) {
          obj.collapsed = true;
          return JSON.stringify(obj);
        }
        return l;
      } catch {
        return l;
      }
    });
    await fs.writeFile(filePath, newLines.join('\n'), 'utf-8');
  }
}
