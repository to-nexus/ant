import { SessionPort, FileTreeUpdatePort } from "../../../core/ports";
import type {
  SessionableJobType,
  FeatureLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
  FeatureBreadcrumbLine,
  FeatureAssistantTurnLine,
  FeatureContextSummaryLine,
  FeatureBoundaryLine,
  ChatLine,
  ChatUserTurnLine,
  LogJobType,
} from '@ant/shared';
import * as crypto from "crypto";
import { Session, SessionRun, SessionArtifacts, SessionState } from "../../../core/types";
import { parseSession, safeParseSession } from "../../../core/schemas/session.schema";
import { wouldRegressRun } from "../../../core/utils/sessionRunGuard";
import * as fs from "fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import * as readline from "node:readline";
import { pipeline } from "node:stream/promises";
import * as path from "path";
import {
  getSessionFilePath,
  getSessionsDir,
  getFeatureJsonlPath,
  getChatJsonlPath,
  readSessionTextBoundedAsync,
  readJsonlTailBounded,
  JSONL_COMPACT_TRIGGER_BYTES,
  JSONL_LINE_MAX_BYTES,
  JsonlLineTooLargeError,
} from "../../../core/utils/sessionPaths";
import { writeSessionBounded } from "../../../core/session/stateBudget";


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
 * Cross-pod chat.jsonl lock provider.
 *
 * O_APPEND provides POSIX atomicity only for writes ≤ PIPE_BUF (usually
 * 4KB). Chat lines carrying large `actionMetadata`, long `assistant_message`
 * text, or big file diffs can exceed that and interleave across pods
 * writing to the same EFS mount. Every caller of `appendLine('chat', ...)`
 * acquires this cross-pod lock before writing.
 *
 * In single-process mode (tests, local dev without Redis), no provider is
 * registered and the in-process `FileMutex` alone is sufficient.
 *
 * The provider is injected once at bootstrap by `registerChatLogLock()`, which
 * the API composition root and the job-runner child both call. It went
 * unregistered in production for a long time, which meant neither the appends
 * nor the whole-file collapse rewrites were serialized across pods at all
 * (M-NEW-029).
 *
 * **Failure policy is asymmetric, and deliberately so:**
 *   - APPEND is best-effort. A chat line must never be lost because Redis was
 *     slow; the in-process mutex still orders same-process writers, and this is
 *     exactly the behaviour that shipped while no provider existed.
 *   - A whole-file REWRITE (chat clear / job delete) requires the lock. It is a
 *     read-modify-write over the entire log, so racing an append silently drops
 *     records. It is also an explicit user action, so a typed failure the user
 *     can retry beats a silent loss.
 */
export interface ChatLogLockProvider {
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

let _chatLogLockProvider: ChatLogLockProvider | null = null;

export function setChatLogLockProvider(provider: ChatLogLockProvider | null): void {
  _chatLogLockProvider = provider;
}

export function getChatLogLockProvider(): ChatLogLockProvider | null {
  return _chatLogLockProvider;
}

const CHATLOG_LOCK_TTL_SECONDS = 5;
/**
 * A whole-file rewrite streams the entire log, so it can outlive the append
 * TTL — a lock that expires mid-rewrite is worse than none, because it reads
 * as protection. Sized above the slowest realistic collapse.
 */
const CHATLOG_REWRITE_LOCK_TTL_SECONDS = 60;
const CHATLOG_LOCK_RETRY_MS = 20;
const CHATLOG_LOCK_MAX_RETRIES = 250; // ≈ 5s worst case

async function acquireChatLogLockBlocking(
  provider: ChatLogLockProvider,
  lockKey: string,
  ttlSeconds: number,
): Promise<void> {
  for (let i = 0; i < CHATLOG_LOCK_MAX_RETRIES; i++) {
    if (await provider.acquireLock(lockKey, ttlSeconds)) return;
    await new Promise((resolve) => setTimeout(resolve, CHATLOG_LOCK_RETRY_MS));
  }
  throw new Error(`chatlog lock timeout: ${lockKey}`);
}

/**
 * Wire the cross-pod JSONL lock to the process's Redis state store.
 *
 * `StateStorePort` already exposes exactly `acquireLock`/`releaseLock`, so this
 * is a registration, not an adapter. Both the API composition root and the
 * job-runner child call it: they append to the same logs on the same shared
 * mount, so a lock only one of them takes orders nothing.
 */
export function registerChatLogLock(store: ChatLogLockProvider): void {
  setChatLogLockProvider(store);
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
   * Chat-log-only adapter: `chat.jsonl` / `feature.jsonl` appends and reads
   * work as usual, but the session-JSON write family (`save` / `addRun` /
   * `updateArtifacts`) is a warn + no-op. Chat-layer callers never own a
   * session file, and the agent-dir side effect of a stray `save()` would
   * scaffold `sessions/architect/` inside a universal container — this
   * factory removes the `'architect'` literal from the chat layer entirely.
   */
  static forChatLog(featurePath: string, projectId?: string, featureName?: string): FileSessionAdapter {
    const adapter = new FileSessionAdapter(featurePath, 'chat-log-only', projectId, featureName);
    const refuse = (op: string) => {
      console.warn(`[FileSessionAdapter] ${op}() refused on a chat-log-only adapter (featurePath=${featurePath})`);
    };
    adapter.save = async () => refuse('save');
    adapter.addRun = async () => refuse('addRun');
    adapter.updateArtifacts = async () => refuse('updateArtifacts');
    return adapter;
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
   * Check whether the feature directory itself exists on disk.
   *
   * Session writes must NEVER materialize a feature path that was not created
   * through the canonical feature-creation flow (FeatureCrudService.createFeature
   * → ensureCanonicalStructure). Without this guard, a stray chat append for a
   * deleted / never-created feature silently produces a partial "ghost" feature
   * directory containing only `sessions/...`, missing every canonical input /
   * output subdirectory.
   */
  private async featureDirExists(): Promise<boolean> {
    try {
      await fs.access(this.featurePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the sessions directory exists. Bails out silently if the enclosing
   * feature directory is missing (prevents ghost features — see
   * `featureDirExists`).
   */
  private async ensureDirectory(_project: string, _feature: string): Promise<void> {
    if (!(await this.featureDirExists())) {
      console.warn(
        `[FileSessionAdapter] feature path missing; skipping sessions dir creation: ${this.featurePath}`,
      );
      return;
    }
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
      // Bound the read on its own descriptor (M-NEW-029): a session grown past
      // the budget must not be materialised and JSON-parsed on the load path.
      const content = await readSessionTextBoundedAsync(sessionPath);

      if (content === null) {
        console.log(`📝 Missing session file detected, creating new session`);
        return this.createNewSession(project, feature);
      }
      if (content.trim() === "") {
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
    
    // Write budget (M-NEW-029): never write a session no reader can open again.
    // `load()` refuses past SESSION_MAX_BYTES, and updateArtifacts/addRun both
    // load first — so a file written over the line bricks itself permanently.
    // The seam sheds first (compaction before failure) and refuses without
    // touching the previous valid file; it also owns the atomic tmp+rename, so
    // there is exactly one copy of that sequence.
    await writeSessionBounded(sessionPath, session);
    
    if (this.fileTreeUpdate) {
      this.fileTreeUpdate.notifyFileTreeUpdate(this.projectId, this.featureName);
    }
  }
  
  /**
   * Load for a read-modify-write, recovering a session that is already over the
   * read budget.
   *
   * Such a file predates the write budget above (nothing can produce one now),
   * but while it sits there `load()` throws and every mutation through this
   * adapter fails forever — the session is bricked with no way back. Set the
   * oversized file aside into a DIRECTORY (`{job}.oversized/`, the same shape
   * `archive.ts` uses) rather than a `.json` sibling: the universal run helpers
   * enumerate `*.json` and would otherwise re-materialise it on every history
   * call and surface it as a phantom job. Nothing is deleted — the bytes stay
   * on disk for recovery — and the live path continues from a fresh session.
   */
  private async loadForMutation(project: string, feature: string, job: SessionableJobType): Promise<Session> {
    try {
      return await this.load(project, feature, job);
    } catch (err: any) {
      if (err?.code !== 'SESSION_TOO_LARGE') throw err;
      const sessionPath = this.getSessionPath(project, feature, job);
      const asideDir = `${sessionPath.slice(0, -'.json'.length)}.oversized`;
      try {
        await fs.mkdir(asideDir, { recursive: true });
        await fs.rename(sessionPath, path.join(asideDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
        console.error(
          `🚨 [Session] Oversized session set aside (not deleted): ${sessionPath} -> ${asideDir}`,
        );
      } catch (renameErr) {
        console.error(`❌ [Session] Could not set aside oversized session ${sessionPath}:`, renameErr);
        throw err;
      }
      return this.createNewSession(project, feature);
    }
  }

  /**
   * Add a new run to the session (serialized with per-job lock)
   */
  async addRun(project: string, feature: string, job: SessionableJobType, run: SessionRun): Promise<void> {
    const lock = this.getFileLock(job);
    await lock.runExclusive(async () => {
      const session = await this.loadForMutation(project, feature, job);

      if (!run.timestamp) {
        run.timestamp = new Date().toISOString();
      }

      // Upsert by jobId when the run carries an identity (architect code/design
      // terminal runs). This keeps exactly one run per jobId so the Job-tab
      // restore (`runs.find(r => r.jobId === jobId)`) and the snapshot writer
      // converge on the same entry. Legacy callers that omit `jobId` (planner,
      // design learn) always append, preserving their behavior.
      const idx = run.jobId ? session.runs.findIndex((r) => r.jobId === run.jobId) : -1;
      if (idx >= 0) {
        const existing = session.runs[idx];
        // Monotonicity guard (shared SSOT): never let an upsert regress an
        // existing run's terminal state / completed count. Merge the I/O
        // fields regardless, but keep the existing snapshot+status when the
        // incoming would be a regression.
        if (run.kanbanSnapshot && wouldRegressRun(existing, run.status, run.kanbanSnapshot)) {
          const { kanbanSnapshot: _drop, status: _dropStatus, ...nonRegressing } = run;
          session.runs[idx] = { ...existing, ...nonRegressing, runId: existing.runId };
        } else {
          session.runs[idx] = { ...existing, ...run, runId: existing.runId };
        }
      } else {
        if (!run.runId) {
          run.runId = session.runs.length + 1;
        }
        session.runs.push(run);
      }
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
      const session = await this.loadForMutation(project, feature, job);
      
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
  // feature.jsonl / chat.jsonl — context & UI log (append-only JSONL)
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
   * Append a line to feature.jsonl or chat.jsonl.
   * Append-only. JSON.stringify(line) + '\n'.
   *
   * Bails silently if the enclosing feature directory is missing (ghost guard).
   *
   * Refuses a single line over {@link JSONL_LINE_MAX_BYTES} with a typed error
   * BEFORE anything durable happens. This is not the total-size bound (that is
   * retention's job below) — a line past the reader window would blank the
   * whole log for every bounded reader, so refusing it is the only
   * observably-lossless outcome. Field-agnostic on purpose: whatever field a
   * future producer inflates, the seam measures the serialized line.
   */
  async appendLine(file: 'feature' | 'chat', line: FeatureLine | ChatLine): Promise<void> {
    if (!(await this.featureDirExists())) {
      console.warn(
        `[FileSessionAdapter] feature path missing; skipping ${file}.jsonl append: ${this.featurePath}`,
      );
      return;
    }
    const filePath = file === 'feature'
      ? getFeatureJsonlPath(this.featurePath)
      : getChatJsonlPath(this.featurePath);

    const content = JSON.stringify(line) + '\n';
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > JSONL_LINE_MAX_BYTES) {
      throw new JsonlLineTooLargeError(filePath, bytes, JSONL_LINE_MAX_BYTES);
    }

    await this.withJsonlLock(filePath, { requireCrossPod: false }, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, 'utf-8');
    });
    // Retention runs OUTSIDE the append lock: the trim/heal pass takes the
    // cross-pod rewrite lock itself and FileMutex is non-reentrant, so calling
    // it under the append lock would self-deadlock.
    await this.compactIfOverGrown(filePath);
  }

  /**
   * Run `fn` under this file's in-process mutex AND, when a provider is
   * registered, the cross-pod lock for the same file.
   *
   * One helper so append and rewrite cannot drift onto different keys — they
   * are only mutually exclusive if they contend for the same one. See the
   * `ChatLogLockProvider` docblock for why `requireCrossPod` differs between
   * the two callers.
   */
  private async withJsonlLock(
    filePath: string,
    opts: { requireCrossPod: boolean },
    fn: () => Promise<void>,
  ): Promise<void> {
    const lock = this.getJsonlLock(filePath);
    const provider = _chatLogLockProvider;
    const key = provider ? this.crossPodLockKey(filePath) : null;
    await lock.runExclusive(async () => {
      let held = false;
      if (provider && key) {
        try {
          await acquireChatLogLockBlocking(
            provider,
            key,
            opts.requireCrossPod ? CHATLOG_REWRITE_LOCK_TTL_SECONDS : CHATLOG_LOCK_TTL_SECONDS,
          );
          held = true;
        } catch (err) {
          if (opts.requireCrossPod) throw err;
          console.warn(
            `[FileSessionAdapter] cross-pod lock unavailable, appending anyway: ${key}`,
          );
        }
      }
      try {
        await fn();
      } finally {
        if (held && provider && key) {
          await provider.releaseLock(key).catch(() => { /* best-effort */ });
        }
      }
    });
  }

  /** Per-file cross-pod key — unrelated features never contend. */
  private crossPodLockKey(filePath: string): string {
    const kind = filePath === getChatJsonlPath(this.featurePath) ? 'chat' : 'feature';
    return `ant:chatlog:${this.projectId}:${this.featureName}:${kind}`;
  }

  /**
   * Trim a JSONL log back to the readers' window once it has grown well past it.
   *
   * The append path had no growth budget at all, but REFUSING an append is the
   * wrong shape of fix: it stops chat working to bound a cost that nobody can
   * observe anyway. `readJsonlTailBounded` already serves only the newest
   * `JSONL_READ_MAX_BYTES`, so everything before that window is storage no
   * reader can reach — dropping it loses nothing observable, while letting it
   * grow costs EFS and every rewrite that must stream the whole file
   * (M-NEW-029).
   *
   * The trigger sits above the window so a log hovering at the boundary is not
   * rewritten on every append; the amortized cost is one streaming pass per
   * `JSONL_COMPACT_TRIGGER_BYTES − JSONL_READ_MAX_BYTES` of new content.
   *
   * Runs AFTER the append lock is released and takes the cross-pod REWRITE
   * lock itself — a trim is a read-modify-write over the whole log, so racing
   * another pod's append would silently drop records. Lock unavailability
   * skips the pass (the next append retries); a lock-free `stat` fast path
   * keeps the per-append cost at one stat while the log is under the trigger.
   */
  private async compactIfOverGrown(filePath: string): Promise<void> {
    try {
      const fastStat = await fs.stat(filePath);
      if (fastStat.size <= JSONL_COMPACT_TRIGGER_BYTES) return;
      await this.withJsonlLock(filePath, { requireCrossPod: true }, async () => {
        const stat = await fs.stat(filePath);
        if (stat.size <= JSONL_COMPACT_TRIGGER_BYTES) return; // another pod's pass won
        let tail = await readJsonlTailBounded(filePath);
        if (tail && tail.lines.length === 0) {
          // The newest window sits entirely inside ONE oversized line (written
          // before the line cap existed): every bounded reader gets zero lines
          // — the log looks blank — and a trim has no complete line to keep.
          // Heal by dropping oversized lines without materialising them, then
          // re-read what remains.
          await this.dropOversizedLinesStreaming(filePath);
          tail = await readJsonlTailBounded(filePath);
        }
        if (!tail || tail.lines.length === 0) return;
        const healedSize = (await fs.stat(filePath)).size;
        if (healedSize <= JSONL_COMPACT_TRIGGER_BYTES) return;
        // `lines` are the RAW serialized lines, not parsed objects — write them
        // back verbatim so an unparseable line survives a trim exactly as it
        // survives a collapse.
        const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        await fs.writeFile(tmpPath, tail.lines.join('\n') + '\n', 'utf-8');
        await fs.rename(tmpPath, filePath);
        console.warn(
          `🗜️  [FileSessionAdapter] Trimmed ${filePath} to the reader window ` +
          `(${stat.size} bytes → ${tail.lines.length} lines)`,
        );
      });
    } catch (err: any) {
      // Never fail an append because a retention pass could not run.
      console.warn(`[FileSessionAdapter] JSONL compaction skipped: ${err?.message}`);
    }
  }

  /**
   * Rewrite a JSONL file dropping every line whose serialized size exceeds
   * {@link JSONL_LINE_MAX_BYTES}, without ever materialising an oversized line:
   * bytes of the current line are buffered only up to the cap, past which the
   * scanner discards and skips to the next newline. Heap ceiling is the line
   * cap plus one read chunk (`readline` would materialise the whole oversized
   * line as one string — exactly the allocation this pass exists to avoid).
   * Caller must hold this file's rewrite lock.
   */
  private async dropOversizedLinesStreaming(filePath: string): Promise<void> {
    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const NEWLINE = 0x0a;
    const out = createWriteStream(tmpPath);
    let kept = 0;
    let dropped = 0;
    try {
      const write = async (buf: Buffer): Promise<void> => {
        if (!out.write(buf)) {
          await new Promise<void>((resolve, reject) => {
            out.once('drain', resolve);
            out.once('error', reject);
          });
        }
      };
      let pending: Buffer[] = [];
      let pendingBytes = 0;
      let skipping = false;
      for await (const chunk of createReadStream(filePath)) {
        const buf = chunk as Buffer;
        let start = 0;
        while (start <= buf.length) {
          const nl = buf.indexOf(NEWLINE, start);
          const end = nl === -1 ? buf.length : nl;
          const sliceLen = end - start;
          if (!skipping && sliceLen > 0) {
            if (pendingBytes + sliceLen > JSONL_LINE_MAX_BYTES) {
              pending = [];
              pendingBytes = 0;
              skipping = true;
              dropped++;
            } else {
              pending.push(buf.subarray(start, end));
              pendingBytes += sliceLen;
            }
          }
          if (nl === -1) break;
          if (skipping) {
            skipping = false;
          } else if (pendingBytes > 0) {
            await write(Buffer.concat([...pending, Buffer.from('\n')]));
            kept++;
            pending = [];
            pendingBytes = 0;
          }
          start = nl + 1;
        }
      }
      // A trailing fragment without a newline is an interrupted append —
      // preserve it (terminated) when it fits, exactly as a collapse would.
      if (!skipping && pendingBytes > 0) {
        await write(Buffer.concat([...pending, Buffer.from('\n')]));
        kept++;
      }
      await new Promise<void>((resolve, reject) => {
        out.once('error', reject);
        out.end(resolve);
      });
      await fs.rename(tmpPath, filePath);
      console.warn(
        `🗜️  [FileSessionAdapter] Dropped ${dropped} oversized line(s) from ${filePath} (${kept} kept)`,
      );
    } catch (err) {
      out.destroy();
      await fs.rm(tmpPath, { force: true }).catch(() => { /* best-effort */ });
      throw err;
    }
  }

  /**
   * Append a user_turn to feature.jsonl (context SSOT) and chat.jsonl (UI).
   *
   * ask / inline-ask 턴도 feature.jsonl 에 기록된다 (Context Lens P2) —
   * 라인에 `ephemeral: true` 를 실어 조립 시 최우선 강등 대상으로 표시한다.
   * 레거시 `skipFeature` 옵션은 하위 호환용으로만 남아 있다 (신규 호출 금지).
   *
   * chat.jsonl에는 항상 기록 (UI 연속성).
   *
   * **Atomicity contract**: feature.jsonl and chat.jsonl are append-only and
   * each has its own per-file lock, but the two appends are NOT atomic across
   * a process crash between them. The invariant enforced here is:
   *
   *   feature.jsonl is the context SSOT → it MUST succeed or throw.
   *   chat.jsonl is UI-only → if it fails AFTER feature succeeded, we log
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
    options: {
      skipFeature?: boolean;
      actionMetadata?: import('../../../core/context/actionMetadataBudget').BoundedActionMetadata;
    } = {},
  ): Promise<void> {
    // 1. feature.jsonl에 append (skipFeature가 true면 건너뜀). 실패 시 throw.
    if (!options.skipFeature) {
      await this.appendLine('feature', line);
    }

    // 2. chat.jsonl에 사본 append. Idempotent by turnId — the API route
    //    (`ChatService.appendUserTurn`) is the durable owner of the UI copy
    //    for chat-initiated turns and writes it at submit time. If that line
    //    is already present we skip here so no duplicate results; inferred /
    //    Actions-panel jobs (no submit-time write) still record it. Failure
    //    here does NOT abort the feature-side record — feature.jsonl is the
    //    context SSOT.
    if (await this.hasChatUserTurn(line.turnId)) {
      return;
    }
    const sourceRef = options.skipFeature
      ? 'ask-only'
      : `feature.jsonl#${line.turnId}`;
    const chatCopy: ChatUserTurnLine = {
      type: 'user_turn',
      ts: line.ts,
      jobId: line.jobId,
      turnId: line.turnId,
      jobType: line.jobType,
      text: line.text,
      sourceRef,
      ...(options.actionMetadata && Object.keys(options.actionMetadata).length > 0 && { actionMetadata: options.actionMetadata }),
    };
    try {
      await this.appendLine('chat', chatCopy);
    } catch (chatErr) {
      // For ask/inline-ask skipFeature=true, feature was never written, so the
      // turn is effectively lost for both context AND UI — surface the error.
      if (options.skipFeature) throw chatErr;
      // Otherwise: feature.jsonl already carries the authoritative record.
      // Log and continue — the UI will be missing one turn copy but the
      // context pipeline (resolve → plan/direct) remains coherent.
      console.warn(
        `[FileSessionAdapter] chat.jsonl append failed for turnId=${line.turnId}; ` +
          `feature.jsonl record is intact. UI may be missing this turn copy.`,
        chatErr,
      );
    }
  }

  /**
   * True when chat.jsonl already carries a (non-collapsed) user_turn for
   * `turnId`. Used to dedup the worker-side chat copy against the durable
   * submit-time write done by `ChatService.appendUserTurn`. A swept
   * (collapsed) line is treated as absent so the turn can be re-recorded.
   */
  private async hasChatUserTurn(turnId: string): Promise<boolean> {
    try {
      const lines = await this.loadAllChat();
      return lines.some(l => l.type === 'user_turn' && l.turnId === turnId);
    } catch {
      // Read failure must not block recording — fall through to append.
      return false;
    }
  }

  /**
   * Append user_turn_meta patch line (executionTier/reason).
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
   * Append an assistant_turn line to feature.jsonl (Context Lens P2).
   */
  async appendAssistantTurn(line: FeatureAssistantTurnLine): Promise<void> {
    await this.appendLine('feature', line);
  }

  /**
   * Append a context_summary checkpoint line (Context Lens P3).
   */
  async appendContextSummary(line: FeatureContextSummaryLine): Promise<void> {
    await this.appendLine('feature', line);
  }

  /**
   * Append a boundary line to feature.jsonl + collapse all user_turn/user_turn_meta
   * lines before this boundary.
   * 
   * This is the main Collapse mechanism (§4.2 primary compression).
   */
  async appendBoundary(line: FeatureBoundaryLine): Promise<void> {
    if (!(await this.featureDirExists())) {
      console.warn(
        `[FileSessionAdapter] feature path missing; skipping boundary append: ${this.featurePath}`,
      );
      return;
    }
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
   * Read the JSONL log's newest bounded window and return the parsed objects.
   * Safe against partial writes (skips unparseable lines with warning).
   *
   * The single read seam for every public loader below, so the byte/line budget
   * applies to prompt-context builds, the UI's initial chat load, the feature-log
   * endpoints and turn dedupe alike — a whole-file read here put an
   * attacker-influenced allocation into API and worker heap (M-NEW-029). Only the
   * VIEW is bounded: the file on disk keeps every record, and the collapse
   * rewriters below stream rather than truncate.
   */
  private async readJsonlLines<T>(filePath: string): Promise<T[]> {
    const window = await readJsonlTailBounded(filePath);
    if (!window) return [];
    const parsed: T[] = [];
    for (const l of window.lines) {
      try {
        parsed.push(JSON.parse(l));
      } catch {
        console.warn(`[FileSessionAdapter] Skipping malformed JSONL line in ${filePath}`);
      }
    }
    return parsed;
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
    assistantTurns: FeatureAssistantTurnLine[];
    contextSummaries: FeatureContextSummaryLine[];
  }> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<FeatureLine>(filePath);

    // Find index of latest *significant* boundary. job-context-bridge T2
    // deprecated automatic boundaries (`reason: 'auto_job_complete_todo'`)
    // because cutting at task completion silently destroyed cross-job
    // continuity — the next job lost both the prior user_turn AND the
    // breadcrumbs that pointed to its outputs. Only Hard Reset
    // (`reason: 'user_reset'`) still honours the cut. Legacy auto
    // boundaries already on disk are deliberately left in place; treating
    // them as cuts would re-introduce the bug for any feature.jsonl
    // written before this change.
    //
    // Note: `collapsed=true` lines marked by an old auto boundary's
    // collapse phase are NOT recovered (we don't know which boundary
    // caused which marking without a separate marker). Those entries
    // stay filtered below — accepted as one-time loss for already-cut
    // data. New data accumulates without auto cuts.
    let latestBoundaryIdx = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      const line = all[i];
      if (line.type !== 'boundary') continue;
      const reason = (line as FeatureBoundaryLine).reason;
      if (reason === 'auto_job_complete_todo') continue;
      latestBoundaryIdx = i;
      break;
    }

    const userTurns: FeatureUserTurnLine[] = [];
    const userTurnMetas: FeatureUserTurnMetaLine[] = [];
    const breadcrumbs: FeatureBreadcrumbLine[] = [];
    const assistantTurns: FeatureAssistantTurnLine[] = [];
    const contextSummaries: FeatureContextSummaryLine[] = [];

    for (let i = 0; i < all.length; i++) {
      const line = all[i];
      if (line.collapsed) continue;

      if (line.type === 'breadcrumb') {
        // Breadcrumbs는 boundary 무관하게 모두 수집
        breadcrumbs.push(line);
        continue;
      }
      // Conversational lines (+checkpoints)만 boundary 이후 체크
      if (i <= latestBoundaryIdx) continue;
      if (line.type === 'user_turn') {
        userTurns.push(line);
      } else if (line.type === 'user_turn_meta') {
        userTurnMetas.push(line);
      } else if (line.type === 'assistant_turn') {
        assistantTurns.push(line);
      } else if (line.type === 'context_summary') {
        contextSummaries.push(line);
      }
    }

    return { userTurns, userTurnMetas, breadcrumbs, assistantTurns, contextSummaries };
  }

  /**
   * Load chat.jsonl lines grouped by turnId.
   * UI용. 특정 turn의 이벤트 블록을 조회.
   */
  async loadChatByTurnIds(turnIds: string[]): Promise<ChatLine[]> {
    const filePath = getChatJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<ChatLine>(filePath);
    const turnSet = new Set(turnIds);
    return all.filter(l => !l.collapsed && turnSet.has(l.turnId));
  }

  /**
   * Load chat.jsonl lines filtered by jobType (UI filtering).
   */
  async loadChatByJobType(jobTypes: LogJobType[]): Promise<ChatLine[]> {
    const filePath = getChatJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<ChatLine>(filePath);
    const jobTypeSet = new Set(jobTypes);
    return all.filter(l => !l.collapsed && jobTypeSet.has(l.jobType));
  }

  /**
   * Load ALL chat.jsonl lines (UI initial load). Supports optional
   * sinceTs (ISO 8601) and jobTypes filters. Collapsed lines are excluded.
   */
  async loadAllChat(opts: { sinceTs?: string; jobTypes?: LogJobType[] } = {}): Promise<ChatLine[]> {
    const filePath = getChatJsonlPath(this.featurePath);
    const all = await this.readJsonlLines<ChatLine>(filePath);
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
   * tier badge needs to render mode/executionTier/reason for every
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
      else if (line.type === 'user_turn_meta') userTurnMetas.push(line);
    }
    return { userTurns, userTurnMetas };
  }

  /**
   * Collapse feature.jsonl lines whose `jobId` matches — Job-tab clear.
   *
   * Leaves chat.jsonl untouched so the UI chat / activity view retains
   * the deleted job's history. Skips `boundary` lines (structural
   * markers) and already-collapsed lines. A completed sibling job of the
   * same `jobType` has a different `jobId`, so its lines remain visible
   * to future prompts.
   */
  /**
   * Rewrite a JSONL log line by line without holding the file in memory.
   *
   * The collapse paths are read-modify-write, so the bounded WINDOW the readers
   * use would be data loss here — anything outside it would be dropped on the
   * rewrite. Streaming keeps memory flat at one line regardless of file size and
   * preserves every record (M-NEW-029). Unparseable lines pass through verbatim,
   * as they did before.
   *
   * `transform` returns the replacement object, or `null` to keep the line as-is.
   * The write lands via tmp + rename so a crash mid-rewrite cannot leave a
   * half-written log. Callers must already hold the file's lock.
   */
  private async rewriteJsonlStreaming(
    filePath: string,
    transform: (parsed: any) => unknown | null,
  ): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      return; // ENOENT — nothing to collapse
    }
    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const out = createWriteStream(tmpPath, { encoding: 'utf-8' });
    try {
      await pipeline(
        async function* () {
          const rl = readline.createInterface({
            input: createReadStream(filePath, { encoding: 'utf-8' }),
            crlfDelay: Infinity,
          });
          for await (const line of rl) {
            if (!line.trim()) {
              yield `${line}\n`;
              continue;
            }
            let replacement: unknown | null = null;
            try {
              replacement = transform(JSON.parse(line));
            } catch {
              replacement = null; // malformed — pass through
            }
            yield `${replacement === null ? line : JSON.stringify(replacement)}\n`;
          }
        },
        out,
      );
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => { /* best-effort */ });
      throw err;
    }
  }

  async collapseByJobId(jobId: string): Promise<void> {
    const filePath = getFeatureJsonlPath(this.featurePath);
    await this.withJsonlLock(filePath, { requireCrossPod: true }, () =>
      this.rewriteJsonlStreaming(filePath, obj => {
        if (obj.jobId === jobId && obj.type !== 'boundary' && !obj.collapsed) {
          return { ...obj, collapsed: true };
        }
        return null;
      }),
    );
  }

  /**
   * Collapse ALL chat.jsonl lines — Chat Clear / Sweep.
   *
   * `feature.jsonl` is intentionally preserved so the LLM retains
   * conversation context across a chat clear. Hard Reset does NOT use
   * this path — it physically unlinks every session file via
   * `clearCanonicalDirectory` in the `/context/reset` route handler.
   */
  async collapseChatLog(): Promise<void> {
    await this.collapseAllInFile(getChatJsonlPath(this.featurePath));
  }

  // ───── Private JSONL helpers ─────

  private async collapseAllInFile(filePath: string): Promise<void> {
    await this.withJsonlLock(filePath, { requireCrossPod: true }, () =>
      this.rewriteJsonlStreaming(filePath, obj =>
        obj.collapsed ? null : { ...obj, collapsed: true },
      ),
    );
  }

  /**
   * Internal: collapse user_turn/user_turn_meta lines with ts < boundaryTs.
   * Must be called inside a lock (appendBoundary handles locking).
   */
  private async collapseBeforeBoundaryInternal(filePath: string, boundaryTs: string): Promise<void> {
    await this.rewriteJsonlStreaming(filePath, obj => {
      // Collapse conversational lines (user_turn / user_turn_meta /
      // assistant_turn / context_summary) before this boundary timestamp.
      // Breadcrumbs stay (semi-permanent navigation anchors).
      if (
        (obj.type === 'user_turn' || obj.type === 'user_turn_meta' || obj.type === 'assistant_turn' || obj.type === 'context_summary') &&
        !obj.collapsed &&
        obj.ts < boundaryTs
      ) {
        return { ...obj, collapsed: true };
      }
      return null;
    });
  }
}
