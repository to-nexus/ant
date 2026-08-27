/**
 * Session Path Utilities
 * 
 * Centralized path construction for agent-nested session files.
 * All session path construction MUST go through these functions
 * to ensure consistent directory structure across the codebase.
 * 
 * Directory structure:
 *   sessions/
 *     architect/
 *       design.json
 *       code.json
 *       learn.json
 *       debug/              ← subdirs defined by DEBUG_SUBDIRS (SSOT)
 *         prompts/
 *         plans/
 *         logs/
 *         tokens/
 *         figma/
 *       runtime/
 *         design/
 *         code/
 *     planner/
 *       plan.json
 *       debug/
 *         prompts/
 *     feature.jsonl         ← prompt context SSOT (T2+T3)
 *     chat.jsonl            ← UI chat display SSOT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SessionableJobType } from '@ant/shared';
import { CANONICAL_FEATURE_DIRS, CANONICAL_FEATURE_FILE_PATHS, UNIVERSAL_FEATURE, isCanonicalDir, createEmptyFigmaData } from '@ant/shared';
import { UNIVERSAL_DIRNAME, isUniversalProject } from '../customAgents/universalContainer';
import { logger } from '../../utils/logger';
import { toBaseRelative, readTextContainedBase } from '../config/containedIo';
import { WorkspacePathResolver } from '../config/WorkspacePathResolver';

export { CANONICAL_FEATURE_DIRS, isCanonicalDir };

// ============================================
// Agent-Job Mapping
// ============================================

/** Maps a job type to its owning agent */
const JOB_TO_AGENT: Record<string, string> = {
  code: 'architect',
  design: 'architect',
  learn: 'architect',
  ask: 'architect',      // ask debug logs go under architect
  plan: 'planner',
  visual: 'creator',
  // universal session FILES are per-(agentId, jobId) and resolved by the
  // universal runtime directly via getSessionFilePath — this row exists only
  // for jobType-keyed naming consumers (getAgentForJobSafe, cleanup).
  universal: 'universal',
};

/**
 * Get the agent name that owns a given job type.
 * 
 * @param jobType - The job type
 * @returns Agent name (e.g., 'architect', 'planner')
 * @throws Error if job type has no known agent mapping
 */
export function getAgentForJob(jobType: string): string {
  const agent = JOB_TO_AGENT[jobType];
  if (!agent) {
    throw new Error(`Unknown job type for agent mapping: ${jobType}`);
  }
  return agent;
}

/**
 * Safe version that returns a default instead of throwing.
 * Used in SSE/Kanban paths where unknown jobType should not crash the server.
 */
export function getAgentForJobSafe(jobType: string): string {
  return JOB_TO_AGENT[jobType] || 'architect';
}

// ============================================
// Session File Paths
// ============================================

/**
 * Canonical feature-relative directory that holds job-lifecycle session state.
 * A single owner for the literal every path builder below uses, so the file
 * API's reserved-namespace guard and the readers stay in lockstep (M-NEW-029).
 */
export const SESSIONS_DIR_NAME = 'sessions';

/**
 * True when a caller-supplied relative path lands inside the reserved
 * `sessions/**` namespace. The single owner every mutation guard calls, on both
 * planes (canonical feature root and universal container).
 *
 * The comparison runs on the NORMALIZED path: `plan/../sessions/architect/code.json`
 * has a first segment of `plan` but resolves into the reserved tree, so a raw
 * first-segment test waved it through while the containment helper — which
 * normalizes — happily wrote it (M-NEW-029). Callers that already hold the
 * resolved absolute target should pass `path.relative(root, target)`.
 */
export function isReservedSessionRelativePath(relativePath: string): boolean {
  const cleaned = (relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned === '') return false;
  const normalized = path.posix.normalize(cleaned);
  return normalized.split('/')[0] === SESSIONS_DIR_NAME;
}

/**
 * Largest a single session JSON may be for a bounded read. Session state is
 * job-runner-authored and small in normal operation; a file past this is a sign
 * of the M-NEW-029 growth vector (or corruption), and every reader refuses it as
 * `SESSION_TOO_LARGE` rather than materialising and parsing it. Generous for a
 * real accumulated directive/task history, bounded against the 50 MiB body cap.
 */
export const SESSION_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Largest window a JSONL log reader may materialise, and the ceiling on how many
 * lines it will parse out of that window.
 *
 * `feature.jsonl` / `chat.jsonl` are append-only journals that grow with normal
 * use, so unlike a session snapshot they cannot simply be refused — but reading
 * them whole put an attacker-influenced number of bytes into API and worker heap
 * on every UI load, prompt build and turn dedupe (M-NEW-029). Readers take the
 * NEWEST window instead; the file on disk is never truncated.
 */
export const JSONL_READ_MAX_BYTES = 16 * 1024 * 1024;
export const JSONL_MAX_LINES = 200_000;

/**
 * Size at which the append path trims a log back to the reader window.
 *
 * The sentence above — "the file on disk is never truncated" — bounded the READ
 * but left the file growing without limit, so the bytes past the window became
 * storage nobody could reach and a cost every streaming rewrite still paid
 * (M-NEW-029). Trimming to the window is therefore observably lossless: what is
 * dropped is precisely what no reader could return.
 *
 * Set above `JSONL_READ_MAX_BYTES` on purpose. Equal values would rewrite the
 * whole log on nearly every append once it reached the window; the gap is the
 * amortization.
 */
export const JSONL_COMPACT_TRIGGER_BYTES = 24 * 1024 * 1024;

/**
 * Largest a SINGLE serialized JSONL line may be, enforced at the append seam.
 *
 * A line larger than {@link JSONL_READ_MAX_BYTES} is worse than refused — once
 * on disk, the tail window falls entirely inside it, every bounded reader gets
 * ZERO lines (the whole chat goes permanently blank), and the retention pass
 * has no complete line to trim to. Refusing such a line is therefore the only
 * observably-lossless choice: nothing that could ever be read is lost. This is
 * NOT a total-size bound on the log (that stays retention's job — see
 * `compactIfOverGrown`); it is the invariant that every durable line stays
 * observable inside the reader window.
 *
 * Half the window (and equal to {@link SESSION_MAX_BYTES}) so a tail read
 * always yields at least one complete line even after discarding a partial
 * first line. Ingress budgets (`ACTION_METADATA_MAX_SERIALIZED_BYTES`,
 * `DIRECTIVE_MAX_CHARS`) keep normal lines orders of magnitude below this —
 * the seam guard is the field-agnostic last resort, not the primary gate.
 */
export const JSONL_LINE_MAX_BYTES = 8 * 1024 * 1024;

/** Thrown by the JSONL append seam when one serialized line exceeds the cap. */
export class JsonlLineTooLargeError extends Error {
  readonly code = 'JSONL_LINE_TOO_LARGE' as const;
  constructor(readonly filePath: string, readonly size: number, readonly limit: number) {
    super(`JSONL line too large for ${filePath} (${size} > ${limit} bytes)`);
    this.name = 'JsonlLineTooLargeError';
  }
}

/**
 * Read the newest {@link JSONL_READ_MAX_BYTES} of a JSONL log on a single
 * descriptor and return its complete lines, newest-window-first-truncated.
 *
 * The window is taken from the actual opened descriptor's `fstat`, so a file
 * that grew between a caller's check and this read is still bounded. When the
 * window starts mid-file the first (partial) line is discarded so the caller
 * only ever sees whole records, and at most {@link JSONL_MAX_LINES} of them
 * (the tail is kept — these logs are read for their recent end).
 *
 * Returns `null` for a missing/unreadable file so callers can keep their
 * historical "empty log" contract.
 */
export async function readJsonlTailBounded(
  filePath: string,
): Promise<{ lines: string[]; truncated: boolean } | null> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    const size = Number(stat.size);
    const start = Math.max(0, size - JSONL_READ_MAX_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) await handle.read(buf, 0, length, start);
    let text = buf.toString('utf-8');
    let truncated = start > 0;
    if (truncated) {
      const newlineIdx = text.indexOf('\n');
      text = newlineIdx >= 0 ? text.slice(newlineIdx + 1) : '';
    }
    let lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length > JSONL_MAX_LINES) {
      lines = lines.slice(lines.length - JSONL_MAX_LINES);
      truncated = true;
    }
    if (truncated) {
      logger.warn(
        `[sessionPaths] JSONL log exceeded the read budget; serving the newest window only`,
        { component: 'sessionPaths' },
        { filePath, size, budget: JSONL_READ_MAX_BYTES, lines: lines.length },
      );
    }
    return { lines, truncated };
  } finally {
    await handle.close();
  }
}

/**
 * Read a session file bounded to {@link SESSION_MAX_BYTES} on its own descriptor.
 * The single owner every canonical/universal session reader routes through, so a
 * file grown past the budget cannot be pulled whole into API/worker heap and
 * `JSON.parse`d (M-NEW-029). Returns `null` for a missing/unreadable file (the
 * historical reader contract); throws {@link SessionTooLargeError} on oversize.
 */
export function readSessionTextBounded(sessionFilePath: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(sessionFilePath, 'r');
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    if (Number(stat.size) > SESSION_MAX_BYTES) {
      throw new SessionTooLargeError(sessionFilePath, Number(stat.size), SESSION_MAX_BYTES);
    }
    return fs.readFileSync(fd, 'utf-8');
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

/** Async twin of {@link readSessionTextBounded} for `fs.promises` callers. */
export async function readSessionTextBoundedAsync(sessionFilePath: string): Promise<string | null> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(sessionFilePath, 'r');
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    if (Number(stat.size) > SESSION_MAX_BYTES) {
      throw new SessionTooLargeError(sessionFilePath, Number(stat.size), SESSION_MAX_BYTES);
    }
    return await handle.readFile('utf-8');
  } finally {
    await handle.close();
  }
}

/**
 * THE session-JSON read seam. Bounded on the descriptor actually read AND bound
 * to a descriptor descent anchored at the service-owned physical workspace base,
 * so a reparented feature/container root cannot serve another tenant's session
 * (H-017) and a file grown past the budget is never materialised (M-NEW-029).
 *
 * Returns `null` for a missing file — the historical reader contract every
 * caller already has. Throws {@link SessionTooLargeError} past the budget.
 *
 * Out-of-base (`repoType: 'local'`) has no service-owned base to make the target
 * relative to, so it keeps the plain bounded read at the same budget.
 *
 * This function exists because three private near-copies of it had grown
 * (features.routes / sessionCleanup / universalRuns) and the fourth forgot the
 * bound entirely. One owner, so a new caller cannot reach for a weaker one.
 */
export async function readSessionTextContained(absPath: string): Promise<string | null> {
  const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), absPath);
  if (br) {
    const read = readTextContainedBase(br, { maxBytes: SESSION_MAX_BYTES });
    if (!read.ok) {
      if (read.reason === 'missing') return null;
      if (read.reason === 'too-large') throw new SessionTooLargeError(absPath, SESSION_MAX_BYTES, SESSION_MAX_BYTES);
      throw new Error(`session read failed: ${read.reason}`);
    }
    return read.text;
  }
  return readSessionTextBoundedAsync(absPath);
}

/** Thrown by the bounded session readers when a session file exceeds the budget. */
export class SessionTooLargeError extends Error {
  readonly code = 'SESSION_TOO_LARGE' as const;
  constructor(readonly sessionPath: string, readonly size: number, readonly limit: number) {
    super(`Session state too large: ${sessionPath} (${size} > ${limit} bytes)`);
  }
}

/**
 * Get the full path to a session JSON file.
 * 
 * @example getSessionFilePath('/path/to/feature', 'architect', 'design')
 *   → '/path/to/feature/sessions/architect/design.json'
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Agent name (e.g., 'architect', 'planner')
 * @param job - Job name used as filename (e.g., 'design', 'plan')
 * @returns Absolute path to the session file
 */
export function getSessionFilePath(featurePath: string, agent: string, job: string): string {
  return path.join(featurePath, 'sessions', agent, `${job}.json`);
}

/**
 * Get the session file path using job type (auto-resolves agent).
 * 
 * @example getSessionFilePathByJob('/path/to/feature', 'design')
 *   → '/path/to/feature/sessions/architect/design.json'
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param jobType - The job type
 * @returns Absolute path to the session file
 */
export function getSessionFilePathByJob(featurePath: string, jobType: string): string {
  const agent = getAgentForJob(jobType);
  return getSessionFilePath(featurePath, agent, jobType);
}

// ============================================
// Context & Trace Log (feature-level, JSONL)
// ============================================

/**
 * Get the path to feature.jsonl — the prompt context SSOT.
 * 
 * Contains T2(user_turn) + T3(breadcrumb) + boundary lines.
 * Read by resolve node for LLM prompt injection.
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Absolute path to feature.jsonl
 */
export function getFeatureJsonlPath(featurePath: string): string {
  return path.join(featurePath, 'sessions', 'feature.jsonl');
}

/**
 * Get the path to chat.jsonl — the UI chat display SSOT.
 *
 * Every `ChatLine` is append-only journaled here. Reads and writes share
 * this single path. Features whose chat log predates this rename
 * (when the file was named `trace.jsonl`) must migrate by renaming on
 * disk (`mv sessions/trace.jsonl sessions/chat.jsonl`) — the pre-rename
 * name is no longer inspected.
 *
 * @param featurePath - Absolute path to the feature directory
 * @returns Absolute path to chat.jsonl
 */
export function getChatJsonlPath(featurePath: string): string {
  return path.join(featurePath, 'sessions', 'chat.jsonl');
}

// ============================================
// Debug Directories
// ============================================

/**
 * Debug subdirectories per agent — derived from CANONICAL_FEATURE_DIRS.
 *
 * Single source of truth lives in `@ant/shared/canonical.ts`. This map is a
 * convenience projection (`agent → subdir[]`) used by callers that need the
 * structured shape (features.routes.ts cleanup, etc).
 *
 * Do NOT add entries here directly — add them to CANONICAL_DIR_DEFS in
 * `@ant/shared/canonical.ts` and this map picks them up automatically.
 */
export const DEBUG_SUBDIRS: Readonly<Record<string, readonly string[]>> = (() => {
  const acc: Record<string, string[]> = {};
  for (const dir of CANONICAL_FEATURE_DIRS) {
    const match = dir.match(/^sessions\/([^/]+)\/debug\/([^/]+)$/);
    if (match) {
      const [, agent, sub] = match;
      (acc[agent] ??= []).push(sub);
    }
  }
  return acc;
})();

/**
 * Get the debug directory path for an agent.
 *
 * @example getSessionDebugDir('/path/to/feature', 'architect', 'prompts')
 *   → '/path/to/feature/sessions/architect/debug/prompts'
 *
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Agent name
 * @param subdir - Debug subdirectory (e.g., 'prompts', 'plans', 'logs', 'figma')
 * @returns Absolute path to the debug subdirectory
 */
export function getSessionDebugDir(featurePath: string, agent: string, subdir: string): string {
  return path.join(featurePath, 'sessions', agent, 'debug', subdir);
}

/**
 * Debug-dir agent name for the current job process. Universal jobs write
 * debug logs under the custom agent's own id
 * (`{container}/sessions/{agentId}/debug/…`) instead of minting the
 * canonical `architect` skeleton inside the universal container.
 */
export function resolveDebugAgentName(): string {
  if (process.env.ANT_JOB_TYPE === 'universal') {
    const ref = process.env.ANT_CUSTOM_JOB_REF;
    const agentId = ref?.split('/')[0];
    if (agentId) return agentId;
  }
  return 'architect';
}

// ============================================
// Runtime Directory
// ============================================

/**
 * Get the runtime directory path for an agent.
 * Runtime stores large transient data (e.g., Figma exploration results) that
 * must survive pause/resume but should NOT bloat the main session checkpoint.
 * 
 * @example getSessionRuntimeDir('/path/to/feature', 'architect', 'design')
 *   → '/path/to/feature/sessions/architect/runtime/design'
 */
export function getSessionRuntimeDir(featurePath: string, agent: string, subdir: string): string {
  return path.join(featurePath, 'sessions', agent, 'runtime', subdir);
}

// ============================================
// Sessions Directory
// ============================================

/**
 * Get the sessions root directory.
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Optional agent name. If provided, returns agent subdirectory.
 * @returns Absolute path to sessions directory or agent subdirectory
 */
export function getSessionsDir(featurePath: string, agent?: string): string {
  if (agent) {
    return path.join(featurePath, 'sessions', agent);
  }
  return path.join(featurePath, 'sessions');
}

// ============================================
// Search Helpers (for resume/continue)
// ============================================

/** All agent-job pairs that have session files */
export const SESSION_SEARCH_MAP: Array<{ agent: string; job: SessionableJobType }> = [
  { agent: 'architect', job: 'code' },
  { agent: 'architect', job: 'design' },
  { agent: 'architect', job: 'learn' },
  { agent: 'planner', job: 'plan' },
  { agent: 'creator', job: 'visual' },
  // No universal row: universal session files are per-(agentId, jobId) with
  // dynamic names a static scan can never find — universal resume goes
  // through the dedicated route branch, not this map.
];

/**
 * Get all session file paths for a feature (for resume/continue search).
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Array of { path, agent, job } for all possible session files
 */
export function getAllSessionPaths(featurePath: string): Array<{ path: string; agent: string; job: SessionableJobType }> {
  return SESSION_SEARCH_MAP.map(({ agent, job }) => ({
    path: getSessionFilePath(featurePath, agent, job),
    agent,
    job,
  }));
}

// ============================================
// Canonical Feature Files (Backend-only — needs Node.js fs)
// ============================================

/**
 * Content factories for canonical files.
 * Paths are defined in @ant/shared (CANONICAL_FEATURE_FILE_PATHS).
 * Every path listed there MUST have a corresponding factory here.
 */
const FILE_CONTENT_FACTORIES: Record<string, () => string> = {
  'visual/ui/figma/figma.json': () => JSON.stringify(createEmptyFigmaData(), null, 2),
  'visual/game-art/figma/figma.json': () => JSON.stringify(createEmptyFigmaData(), null, 2),
};

/**
 * Canonical files that must exist within every feature.
 * Derived from CANONICAL_FEATURE_FILE_PATHS (@ant/shared) + local content factories.
 * 
 * Used by:
 * - ensureCanonicalStructure() — creates missing files on feature access
 * - FeatureCrudService.createFeature() — via ensureCanonicalStructure()
 */
export const CANONICAL_FEATURE_FILES: ReadonlyArray<{
  relativePath: string;
  getContent: () => string;
}> = CANONICAL_FEATURE_FILE_PATHS.map(p => {
  const factory = FILE_CONTENT_FACTORIES[p];
  if (!factory) throw new Error(`Missing content factory for canonical file: ${p}`);
  return { relativePath: p, getContent: factory };
});

// ============================================
// Ensure Canonical Structure (Reconciliation)
// ============================================

export interface EnsureCanonicalResult {
  /** Number of directories that were actually created (pre-existing dirs not counted). */
  createdDirs: number;
  /** Number of canonical files that were actually created (pre-existing files not counted). */
  createdFiles: number;
}

/**
 * Ensure all canonical directories and files exist within a feature.
 *
 * Idempotent — safe to call on every feature access. Only creates what's missing.
 * This enables retroactive application of new CANONICAL_FEATURE_DIRS / FILES
 * entries to features created before the entry was added.
 *
 * Design constraints:
 * - Guard: returns immediately if featurePath does not exist (prevents ghost features)
 * - Excludes 'codebase' (managed by WorktreeService, may be a git worktree)
 * - mkdir({ recursive: true }) is a no-op for existing dirs
 * - writeFile with 'wx' flag is atomic exclusive-create (safe under multi-pod concurrency)
 *
 * @param featurePath - Absolute path to the feature directory
 * @returns Count of items actually created this call; zero on a healthy feature.
 */
/**
 * Backstop guard: true when the path is a universal plane that must never
 * receive the canonical feature skeleton — either the universal container
 * (`{project}/universal`) or a phantom `{project}/features/universal` on a
 * universal-type project. The primary gates live at the call sites
 * (FileTreeBroadcaster jobType gate, ensureCanonicalFeature middleware);
 * this catches any remaining path so pollution cannot silently recur.
 */
function isUniversalPlanePath(featurePath: string): boolean {
  const normalized = path.resolve(featurePath);
  const base = path.basename(normalized);
  const parent = path.dirname(normalized);
  if (base === UNIVERSAL_DIRNAME && isUniversalProject(parent)) return true;
  if (base === UNIVERSAL_FEATURE && path.basename(parent) === 'features' && isUniversalProject(path.dirname(parent))) {
    return true;
  }
  return false;
}

export async function ensureCanonicalStructure(featurePath: string): Promise<EnsureCanonicalResult> {
  try {
    await fs.promises.access(featurePath);
  } catch {
    return { createdDirs: 0, createdFiles: 0 };
  }

  if (isUniversalPlanePath(featurePath)) {
    logger.warn('[ensureCanonicalStructure] refused to scaffold canonical dirs on a universal plane', {
      component: 'ensureCanonicalStructure',
    }, { featurePath });
    return { createdDirs: 0, createdFiles: 0 };
  }

  const dirs = CANONICAL_FEATURE_DIRS.map(d => path.join(featurePath, d));

  const debugDirs = Object.entries(DEBUG_SUBDIRS).flatMap(([agent, subdirs]) =>
    subdirs.map(sub => path.join(featurePath, 'sessions', agent, 'debug', sub)),
  );

  const dirResults: number[] = await Promise.all(
    [...dirs, ...debugDirs].map(async (d): Promise<number> => {
      const created = await fs.promises.mkdir(d, { recursive: true });
      return typeof created === 'string' ? 1 : 0;
    }),
  );
  const createdDirs = dirResults.reduce<number>((a, b) => a + b, 0);

  const fileResults: number[] = await Promise.all(CANONICAL_FEATURE_FILES.map(async (file): Promise<number> => {
    const filePath = path.join(featurePath, file.relativePath);
    try {
      await fs.promises.writeFile(filePath, file.getContent(), { flag: 'wx' });
      return 1;
    } catch (err: any) {
      if (err.code === 'EEXIST') return 0;
      throw err;
    }
  }));
  const createdFiles = fileResults.reduce<number>((a, b) => a + b, 0);

  if (createdDirs > 0 || createdFiles > 0) {
    logger.info('[ensureCanonicalStructure] reconciled canonical structure', {
      component: 'ensureCanonicalStructure',
    }, { featurePath, createdDirs, createdFiles });
  }

  return { createdDirs, createdFiles };
}

// NOTE: getInitFeatureDirs / getInitSessionDirs were removed — all canonical
// directory creation MUST route through ensureCanonicalStructure to preserve
// SSOT. Callers that need per-init path computation should compose
// CANONICAL_FEATURE_DIRS (and add 'codebase' separately if required).

// ============================================
// Canonical Directory Clearing (Single Source of Truth)
// ============================================

export interface ClearCanonicalDirectoryOptions {
  /** If true, skip the 'sessions' directory entirely (used by transfer operations) */
  skipSessions?: boolean;
}

/**
 * Clear a canonical directory's contents while preserving canonical structure.
 * 
 * This is the SINGLE implementation for "empty a directory" across the codebase.
 * All artifact folder clearing MUST use this function to ensure consistent behavior:
 * 
 * - Files: deleted
 * - Canonical subdirectories: recursively cleared (structure preserved)
 * - Non-canonical subdirectories: fully deleted (rm -rf), including all nested content
 * 
 * @param dirPath - Absolute path to the directory to clear
 * @param relativePath - Path relative to feature root (e.g., 'meta/evals')
 * @param options - Optional behavior configuration
 */
export async function clearCanonicalDirectory(
  dirPath: string,
  relativePath: string,
  options?: ClearCanonicalDirectoryOptions,
): Promise<void> {
  let items: fs.Dirent[];
  try {
    items = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemRelPath = `${relativePath}/${item.name}`;

    if (options?.skipSessions && item.name === 'sessions') continue;

    if (item.isDirectory()) {
      if (isCanonicalDir(itemRelPath)) {
        await clearCanonicalDirectory(itemPath, itemRelPath, options);
      } else {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
    } else {
      await fs.promises.unlink(itemPath);
    }
  }
}
