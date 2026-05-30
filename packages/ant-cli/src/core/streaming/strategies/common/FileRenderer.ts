/**
 * FileRenderer - Handle file operations (create, append, delete)
 */

import * as path from 'path';
import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { GitPort } from '../../../ports/git';
import { FileSystemPort } from '../../../ports/filesystem';
import { FileTreeUpdatePort } from '../../../ports/fileTree';
import { ParsedAction, FileStreamInfo } from '../../types';
import { FileRegistry } from '../../state/FileRegistry';
import { LineBufferManager } from './LineBuffer';
import { normalizeToCodebasePath } from '../../../utils/pathNormalizer';
import { AsyncMutex } from '../../../utils/AsyncMutex';
import { detectCrossAxisLeak, stripRegisteredTags } from '../../OutputTagRegistry';

const designFileLocks = new Map<string, AsyncMutex>();
function getDesignFileLock(fsPath: string): AsyncMutex {
  let lock = designFileLocks.get(fsPath);
  if (!lock) {
    lock = new AsyncMutex();
    designFileLocks.set(fsPath, lock);
  }
  return lock;
}

/**
 * Structured data for cross-worker file conflicts.
 * Contains both contents so execute can inject a merge instruction
 * into the conversation without requiring read_file tool calls.
 */
export interface FileConflict {
  /** Normalized file path */
  path: string;
  /** Content the current worker intended to write */
  intendedContent: string;
  /** Content currently in the file (written by another worker) */
  currentContent: string;
  /** Task name of the file owner */
  ownerTask?: string;
}

export interface FileRendererConfig {
  chatAPI: ChatAPIClient;
  gitPort?: GitPort;
  fileSystem?: FileSystemPort;  // ✅ Add fileSystem
  fileTreeUpdate?: FileTreeUpdatePort;  // ✅ For real-time file tree updates
  writeImmediately: boolean;
  /**
   * Job context for the codebase-write guard.
   * - `code` + `codePhase === 'execute'` → `codebase/` writes allowed
   * - `code` + `codePhase === 'plan'` → `codebase/` writes rejected
   * - `design` / `planner` → `codebase/` writes rejected (artifact paths only)
   *
   * Mirrors `ToolExecutionContext.allowMutateInCodebase` for the
   * tool-handler path — the streaming `<file>`/`<append>`/`<edit>`/
   * `<delete>` path used to bypass that guard, so we close the gate
   * here on the same policy SSOT (see `docs/internals/15-design-job.md`
   * "Codebase mutation gate"). This guard is only about codebase
   * writes; `run_command` is gated separately via
   * `ToolExecutionContext.allowShellExecution` and never goes through
   * the FileRenderer path.
   */
  jobType?: 'code' | 'design' | 'planner';
  /**
   * For `jobType === 'code'`, identifies whether the renderer is
   * driven by the plan or the execute phase. Plan-phase artifacts
   * are the sealed `<plan>` JSON / plan-side documents; mutating
   * `codebase/` belongs to execute. Defaults to `'execute'` when
   * absent so legacy callers keep working.
   */
  codePhase?: 'plan' | 'execute';
  featurePath?: string;
  codebasePath?: string; // ✅ For code jobs: absolute path to repo root (codebase dir)
  /**
   * Optional hook called on a successful file creation / overwrite (XML
   * `<file>` streaming path). Mirrors the tool-handler path's
   * `ToolExecutionContext.recordFileTouch` so `CodeTask.touchedFiles` is
   * populated regardless of which path the LLM uses. chat.jsonl is
   * ephemeral — this hook feeds the session SSOT (code.json).
   */
  onFileTouched?: (filePath: string) => void;
  /**
   * Design-job guard: the feature-relative path the current task is
   * authoritatively allowed to write to (e.g.
   * `"architecture/system/api-contract-main.md"`). When set, any
   * `<file path="...">` whose canonical path differs is auto-corrected
   * to this value before writing.
   *
   * Rationale: prompt instructions alone do not reliably constrain the
   * LLM's chosen filename. A historical regression had decompose hand
   * mismatched section assignments to an `api-contract-main.md` task,
   * which then prompted the execute LLM to hallucinate a
   * `fe-system-main.md` path and silently drop the actual contract
   * document. With this guard the worst-case outcome is content
   * landing in the correct file even when the LLM gets the filename
   * wrong, instead of a missing artifact.
   *
   * Only enforced when `jobType === 'design'` — code jobs legitimately
   * write multiple files per turn.
   */
  expectedTargetFile?: string;
}

export class FileRenderer {
  private chatAPI: ChatAPIClient;
  private gitPort?: GitPort;
  private fileSystem?: FileSystemPort;  // ✅ Add fileSystem property
  private fileTreeUpdate?: FileTreeUpdatePort;  // ✅ For real-time file tree updates
  private writeImmediately: boolean;
  private jobType?: 'code' | 'design' | 'planner';
  private codePhase?: 'plan' | 'execute';
  private featurePath?: string;
  private codebasePath?: string;
  private onFileTouched?: (filePath: string) => void;
  private expectedTargetFile?: string;
  /**
   * Per-renderer dedupe set for `expectedTargetFile` mismatch warnings —
   * `canonicalizePath` is invoked from start / content / end handlers,
   * each typically multiple times for a streamed file. Without this set
   * the same mismatch would log dozens of identical warnings per task.
   */
  private warnedMismatchedPaths: Set<string> = new Set();
  
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private lineBuffers: LineBufferManager = new LineBufferManager();
  
  // ✅ Debounced file tree notification (prevents excessive Redis Pub/Sub during streaming)
  private fileTreeNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FILE_TREE_NOTIFY_DEBOUNCE_MS = 2000;
  
  // ✅ Track unseen artifact paths for badge notifications
  private pendingUnseenPaths: Set<string> = new Set();
  
  // ✅ Track file operation completion
  
  // ✅ Track file operation errors (don't throw, collect for violation)
  private fileErrors: string[] = [];
  // ✅ Cross-worker conflicts with structured data for direct merge
  private fileConflicts: FileConflict[] = [];  
  private completionPromises: Map<string, Promise<void>> = new Map();
  private completionResolvers: Map<string, (value: void | PromiseLike<void>) => void> = new Map();
  private completionRejectors: Map<string, (reason?: any) => void> = new Map();
  
  constructor(config: FileRendererConfig) {
    this.chatAPI = config.chatAPI;
    this.gitPort = config.gitPort;
    this.fileSystem = config.fileSystem;  // ✅ Store fileSystem
    this.fileTreeUpdate = config.fileTreeUpdate;  // ✅ Store fileTreeUpdate
    this.writeImmediately = config.writeImmediately;
    this.jobType = config.jobType;
    this.codePhase = config.codePhase;
    this.featurePath = config.featurePath;
    this.codebasePath = config.codebasePath;
    this.onFileTouched = config.onFileTouched;
    this.expectedTargetFile = config.expectedTargetFile;
  }

  /**
   * Pin the design-job target filename guard for the current task. See
   * `FileRendererConfig.expectedTargetFile` for the full rationale.
   * Called per-task from docGen so a single renderer instance can be
   * reused across worker turns without leaking the previous task's
   * expected target.
   */
  setExpectedTargetFile(expectedTargetFile: string | undefined): void {
    this.expectedTargetFile = expectedTargetFile;
    this.warnedMismatchedPaths.clear();
  }

  /**
   * Design-job filename guard — see `FileRendererConfig.expectedTargetFile`.
   *
   * Returns the path the renderer should treat as authoritative. When the
   * LLM-emitted path matches the expected target, returns it unchanged;
   * when it differs, logs a warning and returns the expected path so the
   * write lands in the correct file. Code jobs and design jobs without an
   * `expectedTargetFile` configured pass through unchanged.
   *
   * Comparison is by basename only — the `<file path="...">` value the
   * LLM emits is feature-relative (e.g. `architecture/system/foo.md`)
   * and `expectedTargetFile` is also feature-relative, so a basename-only
   * check tolerates the LLM picking a sibling subdirectory while still
   * catching wrong filenames. (Subdirectory mismatch is fixed at the
   * full-path level by replacing the canonical path entirely.)
   */
  private enforceExpectedTargetFile(canonicalPath: string): string {
    if (this.jobType !== 'design') return canonicalPath;
    if (!this.expectedTargetFile) return canonicalPath;

    const incomingBase = path.basename(canonicalPath);
    const expectedBase = path.basename(this.expectedTargetFile);

    if (incomingBase === expectedBase && canonicalPath === this.expectedTargetFile) {
      return canonicalPath;
    }
    const warnKey = `${canonicalPath}→${this.expectedTargetFile}`;
    const alreadyWarned = this.warnedMismatchedPaths.has(warnKey);
    if (!alreadyWarned) this.warnedMismatchedPaths.add(warnKey);

    if (incomingBase === expectedBase) {
      // Same filename, different subdirectory — pin to the canonical
      // expected location so doc-gen invariants
      // (e.g. `architecture/system/` vs `architecture/spec/`) hold.
      if (!alreadyWarned) {
        console.warn(
          `⚠️ [FileRenderer] Design path subdirectory mismatch: ` +
          `"${canonicalPath}" → "${this.expectedTargetFile}" ` +
          `(expected target file pinned by current task)`
        );
      }
      return this.expectedTargetFile;
    }
    if (!alreadyWarned) {
      console.warn(
        `⚠️ [FileRenderer] Design filename mismatch: LLM emitted ` +
        `"${canonicalPath}" but current task targets ` +
        `"${this.expectedTargetFile}" — overriding to expected target. ` +
        `(Common cause: decompose mis-assigned a foreign catalog's sections to this task.)`
      );
    }
    return this.expectedTargetFile;
  }
  
  /**
   * Resolve a path that is safe to pass to FileSystemPort.
   *
   * ✅ PROJECT ROOT based - all paths are relative to project root.
   * - Code files: LLM should use "codebase/..." paths
   * - Design files: LLM should use feature-relative domain roots
   *   ("architecture/...", "visual/...") — never absolute or escaped.
   */
  private resolveFileSystemPath(originalPath: string): string {
    if (!this.fileSystem) return originalPath;

    // If caller accidentally passed an absolute path, normalize it back to project-root-relative.
    if (path.isAbsolute(originalPath)) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath) {
        return path.relative(rootPath, originalPath);
      }
      return originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
    }

    // Design jobs: prefix with feature directory relative path
    if (this.jobType === 'design' && this.featurePath) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath && path.isAbsolute(this.featurePath)) {
        const featureDirRel = path.relative(rootPath, this.featurePath);
        return path.join(featureDirRel, originalPath);
      }
    }

    // Code jobs: normalize path via the single source of truth (normalizeToCodebasePath).
    // This ensures consistency with tool handlers (resolveToolPath) — both read and write
    // paths agree. Handles all cases: bare paths, double-nesting, sibling dirs, etc.
    if (this.jobType === 'code' && this.codebasePath) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath) {
        const codebaseRel = path.relative(rootPath, this.codebasePath).replace(/\\/g, '/') || 'codebase';
        const { normalized, wasFixed, reason } = normalizeToCodebasePath(originalPath, codebaseRel);
        if (wasFixed) {
          console.warn(`⚠️ [FileRenderer] Path auto-corrected: "${originalPath}" → "${normalized}" (${reason})`);
        }
        return normalized;
      }
    }

    return originalPath;
  }

  /**
   * Canonicalize a streamed file path into a stable key.
   *
   * ✅ PROJECT ROOT based - paths are used as-is (just normalize separators).
   * LLM should use consistent paths:
   * - "codebase/package.json" for code files
   * - "architecture/system/...", "architecture/spec/...", "visual/ui/...",
   *   "visual/game-art/..." for design / visual files (feature-relative).
   *
   * For design jobs the result is then run through the optional
   * `expectedTargetFile` guard (see `enforceExpectedTargetFile`) so all
   * three streaming handlers (`renderFileStart` / `renderFileContent` /
   * `renderFileEnd`) operate on the same corrected key — without this
   * the start would land on one filename and content/end on another, and
   * the registry would split a single LLM emission across two entries.
   */
  private canonicalizePath(originalPath: string): string {
    const base = originalPath.replace(/\\/g, '/').replace(/^\.?\//, '');
    return this.enforceExpectedTargetFile(base);
  }

  /**
   * Handle file_start action
   */
  async renderFileStart(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath, actionType } = action.data;
    
    if (!filePath) {
      console.error('[FileRenderer] file_start without filePath');
      return;
    }

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) {
      const msg = `[FileRenderer] Invalid/empty canonical path derived from: "${filePath}"`;
      console.error(msg);
      this.fileErrors.push(msg);
      return;
    }
    
    // Check for duplicates
    if (registry.hasStreamed(canonicalPath)) {
      const previousInfo = registry.getFileInfo(canonicalPath);
      const previousActionType = previousInfo?.actionType;
      
      console.log(`[Render] ⚠️  File ${canonicalPath} already streamed (previous: ${previousActionType}, new: ${actionType})`);
      
      const isFullReplacement = 
        previousActionType === 'create' &&
        (actionType === 'create' || !actionType);
      
      const isIncrementalChange = 
        previousActionType === 'create' && 
        actionType === 'append';
      
      if (isFullReplacement) {
        console.log(`[Render] 🔄 Full overwrite - replacing entire file (multi-turn)`);
        
        registry.resetFile(canonicalPath);
        this.activeFiles.delete(canonicalPath);
        this.lineBuffers.clear(canonicalPath);
      } else if (isIncrementalChange) {
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        return;
      } else {
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn): ${previousActionType} → ${actionType}`);
        
        this.activeFiles.set(canonicalPath, {
          filePath: canonicalPath,
          actionType: 'skip' as any,
          contentBuffer: '',
          startedAt: Date.now()
        });
        
        return;
      }
    }
    
    // Determine final action type
    let finalActionType: 'create' | 'append';
    
    if (actionType === 'append') {
      finalActionType = 'append';
    } else {
      // <file> tag: No existence check needed (intentional overwrite)
      finalActionType = 'create';
    }
    registry.markAsStreamed(canonicalPath, finalActionType);

    // ✅ Determine isOverwrite from two sources:
    // 1. Explicit `<file overwrite="true">` attribute from LLM (intentional takeover)
    // 2. registry.isKnownAtStart() — file existed in codebase at execute start
    //    (legitimate overwrite of pre-existing on-disk file)
    //
    // Neither source covers "sibling task already wrote this file during the
    // current job" — that case is intentionally treated as NEW (isOverwrite=false)
    // so SharedFileBuffer's isNewFile conflict check fires and prevents silent
    // cross-task clobber. LLM must emit explicit `overwrite="true"` to confirm.
    const explicitOverwrite = action.data.overwrite === true;
    const isOverwrite = explicitOverwrite || registry.isKnownAtStart(canonicalPath);

    this.activeFiles.set(canonicalPath, {
      filePath: canonicalPath,
      actionType: finalActionType,
      startedAt: Date.now(),
      contentBuffer: '',
      isOverwrite,
    } as any);
    
    this.lineBuffers.init(canonicalPath);
    
    // ✅ Create completion promise for this file
    const completionPromise = new Promise<void>((resolve, reject) => {
      this.completionResolvers.set(canonicalPath, resolve);
      this.completionRejectors.set(canonicalPath, reject);
    });
    this.completionPromises.set(canonicalPath, completionPromise);
    
    await this.chatAPI.startFileCreation(canonicalPath);
  }
  
  /**
   * Handle file_content action
   */
  async renderFileContent(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath, content, metadata } = action.data;
    
    if (!filePath || content === undefined) {
      return;
    }

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) return;
    
    const fileInfo = this.activeFiles.get(canonicalPath);
    if (!fileInfo) {
      console.warn(`[Render] file_content for non-started file: ${canonicalPath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      return;
    }
    
    registry.appendContent(canonicalPath, content);
    fileInfo.contentBuffer += content;
    
    // Real-time streaming for create and append
    const completeLines = this.lineBuffers.addContent(canonicalPath, content);
    
    if (completeLines.length > 0) {
      const newContent = completeLines.join('\n') + '\n';
      await this.chatAPI.streamFileContent(canonicalPath, newContent);
    }
  }
  
  /**
   * Handle file_end action
   */
  async renderFileEnd(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath } = action.data;
    
    if (!filePath) {
      console.error('[FileRenderer] file_end without filePath');
      return;
    }

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) {
      const msg = `[FileRenderer] Invalid/empty canonical path derived from: "${filePath}"`;
      console.error(msg);
      this.fileErrors.push(msg);
      return;
    }
    
    const fileInfo = this.activeFiles.get(canonicalPath);
    if (!fileInfo) {
      console.warn(`[Render] file_end for non-started file: ${canonicalPath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      console.log(`[Render] ⏭️  Skipping file_end for duplicate edit: ${canonicalPath}`);
      this.cleanup(canonicalPath);
      return;
    }
    
    console.log(`✅ [Render] Completing ${fileInfo.actionType.toUpperCase()}: ${canonicalPath}`);
    
    try {
      // Flush remaining buffer
      const remainingBuffer = this.lineBuffers.getRemainingBuffer(canonicalPath);
      if (remainingBuffer) {
        await this.chatAPI.streamFileContent(canonicalPath, remainingBuffer);
      }
      
      await this.handleCreateOrAppend(canonicalPath, fileInfo);
    } catch (error) {
      await this.handleError(canonicalPath, fileInfo, error);
      
      // ✅ Do NOT reject completion promise - just log error
      // File errors should only be displayed in UI, not interrupt task flow
      
      this.cleanup(canonicalPath);
      
      // ✅ Do NOT re-throw - task should continue despite file errors
      // Error is already recorded in fileErrors and displayed in UI
      return;
    }
    
    // ✅ Success: Resolve completion promise
    const resolver = this.completionResolvers.get(canonicalPath);
    if (resolver) {
      resolver();
    }
    
    this.cleanup(canonicalPath);
  }
  
  /**
   * Handle create or append operation
   */
  private async handleCreateOrAppend(filePath: string, fileInfo: FileStreamInfo): Promise<void> {
    // Capture pre-write line count for <file> overwrites so the UI can
    // render `+Y -X` instead of `+Y` alone. Scoped to code jobs because
    // design overwrites get auto-converted to append (deep-merge) and
    // have no clean old→new diff. Read is best-effort — failure just
    // drops the stat, preserving legacy behaviour. Declared at method
    // scope so the final `completeFileCreation` call can read it
    // regardless of which sub-branch performed the disk write.
    let diffBeforeLines: number | undefined;

    if (this.writeImmediately && this.gitPort && fileInfo.contentBuffer) {
      const fsPath = this.resolveFileSystemPath(filePath);

      const isOverwrite = (fileInfo as any).isOverwrite === true;
      if (isOverwrite && this.jobType === 'code' && this.fileSystem) {
        try {
          const oldContent = await this.fileSystem.readFile(fsPath);
          if (oldContent != null) {
            diffBeforeLines = oldContent.split('\n').length;
          }
        } catch {
          diffBeforeLines = undefined;
        }
      }

      // Codebase mutation gate (XML tag path) — symmetrical to the
      // tool-handler gate in `agents/common/tool/handlers/codebaseGate.ts`.
      //
      // Policy: only the architect/code job's `execute` phase may write
      // under `codebase/`. `<file>`/`<append>`/`<edit>`/`<delete>` from
      // design / planner / code-plan are document-side artifact writes,
      // never source-code mutations. Without this gate the streaming
      // path bypasses the tool-handler gate (a known regression — see
      // `docs/architecture/15-design-job.md` "Codebase mutation gate").
      const codebaseRel = (() => {
        const rootPath = this.fileSystem?.getRootPath?.();
        if (this.codebasePath && rootPath) {
          return path.relative(rootPath, this.codebasePath).replace(/\\/g, '/') || 'codebase';
        }
        return 'codebase';
      })();
      const codebasePrefix = codebaseRel + '/';
      const isCodebaseTarget = fsPath === codebaseRel || fsPath.startsWith(codebasePrefix);
      const codeExecuteAllowed =
        this.jobType === 'code' && this.codePhase !== 'plan';

      // Guard 1 (legacy): code-execute writes must land UNDER codebase/.
      // This rejects sibling domain dirs (architecture/, visual/, assets/,
      // plan/, meta/, sessions/) for code execute — they are artifact
      // destinations for design / planner / visual jobs, not for code.
      if (codeExecuteAllowed && this.codebasePath && !isCodebaseTarget) {
        const msg =
          `File write REJECTED: "${filePath}" resolved to "${fsPath}" which is outside ` +
          `the codebase directory ("${codebaseRel}/"). Code files must be under "${codebaseRel}/".`;
        console.error(`❌ [FileRenderer] ${msg}`);
        this.fileErrors.push(msg);
        await this.chatAPI.failFileCreation(filePath, msg);
        return;
      }

      // Guard 2: design / planner / code-plan never write under codebase/.
      // The artifact this phase produces lives under architecture/ (or
      // plan/, assets/, etc.); source-code changes are deferred to the
      // code job's execute phase.
      if (!codeExecuteAllowed && isCodebaseTarget) {
        const phaseLabel = this.jobType === 'code' ? 'code-plan' : (this.jobType ?? 'this phase');
        const msg =
          `File ${fileInfo.actionType} REJECTED: "${filePath}" is under ${codebaseRel}/, ` +
          `which is read-only for ${phaseLabel}. Write to artifact paths ` +
          `(architecture/, plan/, assets/, visual/, meta/, sessions/) instead. ` +
          `Source-code changes happen in the code job's execute phase — describe the change ` +
          `in the spec / plan document here.`;
        console.error(`❌ [FileRenderer] ${msg}`);
        this.fileErrors.push(msg);
        await this.chatAPI.failFileCreation(filePath, msg);
        return;
      }

      if (this.jobType === 'design') {
        await getDesignFileLock(fsPath).runExclusive(async () => {
          if (fileInfo.actionType === 'append') {
            await this.handleDesignAppend(fsPath, fileInfo.contentBuffer);
          } else {
            const existsOnDisk = await this.fileSystem?.fileExists(fsPath);
            if (existsOnDisk) {
              console.warn(`⚠️ [FileRenderer] <file> tag on existing design doc "${filePath}" — auto-converting to <append>`);
              await this.handleDesignAppend(fsPath, fileInfo.contentBuffer);
            } else {
              if (!this.fileSystem) throw new Error('FileSystemPort not available');
              await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
            }
          }
        });

        if (
          filePath.startsWith('architecture/') ||
          filePath.startsWith('visual/') ||
          filePath.startsWith('meta/evals/')
        ) {
          this.pendingUnseenPaths.add(filePath);
        }
        this.scheduleFileTreeNotification();
        // Disk already wrote the raw `contentBuffer`. The chat-card
        // metadata sees a stripped version so a contract-violating
        // `<reply>` / `<done>` literal in the file body never reaches
        // the file-card preview as a raw `<…>` marker. Disk file stays
        // the truth source — read_file tool / git show the raw content.
        const fileLeaks = detectCrossAxisLeak(fileInfo.contentBuffer, 'artifact');
        if (fileLeaks.length > 0) {
          console.warn(
            `[FileRenderer] <file path="${filePath}"> body contains cross-axis tags: ${fileLeaks.join(', ')}. Stripped from card preview. (See docs/architecture/36-output-tag-matrix.md Invariant 2.)`,
          );
        }
        await this.chatAPI.completeFileCreation(
          filePath,
          stripRegisteredTags(fileInfo.contentBuffer),
        );
        this.onFileTouched?.(filePath);
        return;
      }

      {
        if (!this.fileSystem) throw new Error('FileSystemPort not available');
        
        // Cross-worker conflict detection for file creation and overwrite
        if (isOverwrite) {
          const workerFS = this.fileSystem as any;
          if (typeof workerFS.writeOverwrite === 'function') {
            const result = await workerFS.writeOverwrite(fsPath, fileInfo.contentBuffer);
            if (!result.success) {
              if (result.currentContent !== undefined) {
                console.log(`⚠️ [FileRenderer] Overwrite conflict (direct merge path): ${filePath}`);
                this.fileConflicts.push({
                  path: filePath,
                  intendedContent: fileInfo.contentBuffer,
                  currentContent: result.currentContent,
                  ownerTask: result.ownerTask,
                });
              } else {
                console.log(`⚠️ [FileRenderer] Overwrite conflict (fallback): ${result.error}`);
                this.fileErrors.push(result.error || `File "${filePath}" was modified by another task.`);
              }
              await this.chatAPI.showChatStatus('file_conflict' as any, {
                filePath,
                ownerTask: result.ownerTask,
              });
              await this.chatAPI.failFileCreation(filePath, result.error || 'Cross-worker overwrite conflict');
              return;
            }
          } else {
            await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
          }
        } else {
          const workerFS = this.fileSystem as any;
          if (typeof workerFS.writeNewFile === 'function') {
            const result = await workerFS.writeNewFile(fsPath, fileInfo.contentBuffer);
            if (!result.success) {
              if (result.currentContent !== undefined) {
                console.log(`⚠️ [FileRenderer] Cross-worker conflict (direct merge path): ${filePath}`);
                this.fileConflicts.push({
                  path: filePath,
                  intendedContent: fileInfo.contentBuffer,
                  currentContent: result.currentContent,
                  ownerTask: result.ownerTask,
                });
              } else {
                console.log(`⚠️ [FileRenderer] Cross-worker conflict (fallback): ${result.error}`);
                this.fileErrors.push(result.error || `File "${filePath}" was already created by another task.`);
              }
              await this.chatAPI.showChatStatus('file_conflict' as any, {
                filePath,
                ownerTask: result.ownerTask,
              });
              await this.chatAPI.failFileCreation(filePath, result.error || 'Cross-worker file conflict');
              return;
            }
          } else {
            await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
          }
        }
      }
      
      // ✅ Schedule debounced file tree notification after disk write
      this.scheduleFileTreeNotification();
      
      // ✅ Track generated-artifact files as unseen for badge notification.
      // Domains: architecture/, visual/, meta/evals/.
      if (
        filePath.startsWith('architecture/') ||
        filePath.startsWith('visual/') ||
        filePath.startsWith('meta/evals/')
      ) {
        this.pendingUnseenPaths.add(filePath);
      }
    }
    
    // See the design-path completeFileCreation note above: card metadata
    // gets a stripped copy so contract-violating literals never surface
    // in the file-card preview, while disk holds the raw bytes.
    const codeFileLeaks = detectCrossAxisLeak(fileInfo.contentBuffer, 'artifact');
    if (codeFileLeaks.length > 0) {
      console.warn(
        `[FileRenderer] <file path="${filePath}"> body contains cross-axis tags: ${codeFileLeaks.join(', ')}. Stripped from card preview. (See docs/architecture/36-output-tag-matrix.md Invariant 2.)`,
      );
    }
    await this.chatAPI.completeFileCreation(
      filePath,
      stripRegisteredTags(fileInfo.contentBuffer),
      diffBeforeLines !== undefined ? { diffBeforeLines } : undefined,
    );
    this.onFileTouched?.(filePath);
  }
  
  /**
   * Handle design job append with structured merge for JSON
   * 
   * All UI documents are now JSON format:
   * - ui-tokens.json, ui-assets.json, ui-spec.json
   * - Deep merge objects, update _meta.lastSection
   */
  private async handleDesignAppend(fileSystemPath: string, newContent: string): Promise<void> {
    if (!this.gitPort || !this.fileSystem) return;
    
    try {
      const fileExists = await this.fileSystem.fileExists(fileSystemPath);
      const isJsonFile = fileSystemPath.endsWith('.json');
      
      if (fileExists) {
        const existingContent = await this.fileSystem.readFile(fileSystemPath) || '';
        
        // ✅ JSON files: Deep merge objects
        if (isJsonFile) {
          const mergedContent = this.mergeJsonContent(existingContent, newContent);
          await this.fileSystem!.writeFile(fileSystemPath, mergedContent);
          return;
        }
        
        // ⚠️ Non-JSON files (Markdown): Text append with metadata cleanup
        console.log(`   📄 [Append] Markdown file: ${fileSystemPath}`);
        
        // ✅ Remove old LAST_SECTION metadata before append
        // Pattern: <!-- LAST_SECTION: N --> at end of file (with optional whitespace)
        const cleanedExisting = existingContent
          .replace(/\n?<!-- LAST_SECTION: \d+ -->\s*$/g, '')
          .replace(/\n?<!-- SECTION_PATTERN: [^>]+ -->\s*\n?<!-- LAST_SECTION: \d+ -->\s*$/g, '');
        
        const mergedContent = cleanedExisting.trimEnd() + '\n\n' + newContent;
        await this.fileSystem!.writeFile(fileSystemPath, mergedContent);
      } else {
        await this.fileSystem!.writeFile(fileSystemPath, newContent);
      }
    } catch (error) {
      console.error(`❌ [Append] Failed to append to ${fileSystemPath}:`, error);
      throw error;
    }
  }
  
  /**
   * Deep merge JSON objects
   * - Merges top-level keys from newContent into existingContent
   * - Updates _meta.lastSection with the new value
   */
  private mergeJsonContent(existingContent: string, newContent: string): string {
    try {
      const existingObj = JSON.parse(existingContent);
      const newObj = JSON.parse(newContent);
      
      // Deep merge: new values override existing at leaf level
      const merged = this.deepMerge(existingObj, newObj);
      
      console.log(`   🔄 [JSON Merge] Merged ${Object.keys(newObj).length} top-level key(s)`);
      
      return JSON.stringify(merged, null, 2);
    } catch (error) {
      // If parsing fails, try to salvage by text append (shouldn't happen with valid JSON)
      console.warn(`   ⚠️ [JSON Merge] Parse error, falling back to text append:`, error);
      return existingContent + '\n' + newContent;
    }
  }
  
  /**
   * Convert array with id fields to object keyed by id
   * e.g., [{ id: 'gnb', ... }, { id: 'hero', ... }] → { gnb: {...}, hero: {...} }
   */
  private arrayToObject(arr: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const item of arr) {
      if (item && typeof item === 'object' && 'id' in item) {
        const { id, ...rest } = item;
        result[id] = rest;
      }
    }
    return result;
  }
  
  /**
   * Deep merge two objects
   * - Objects are recursively merged
   * - Arrays are concatenated (for sections arrays)
   * - Handles array-object mismatch for 'sections' key by converting array to object
   * - Primitives from source override target
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      let sourceVal = source[key];
      let targetVal = target[key];
      
      // Special handling for 'sections' key: normalize array to object
      if (key === 'sections') {
        // Convert source array to object if target is object
        if (Array.isArray(sourceVal) && targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
          console.log(`   ⚠️ [YAML Merge] Converting 'sections' from array to object for merge compatibility`);
          sourceVal = this.arrayToObject(sourceVal);
        }
        // Convert target array to object if source is object
        if (Array.isArray(targetVal) && sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
          console.log(`   ⚠️ [YAML Merge] Converting existing 'sections' from array to object`);
          targetVal = this.arrayToObject(targetVal);
          result[key] = targetVal; // Update result with converted value
        }
      }
      
      if (sourceVal && typeof sourceVal === 'object') {
        if (Array.isArray(sourceVal)) {
          // Arrays: concatenate (e.g., sections array in YAML)
          if (Array.isArray(targetVal)) {
            result[key] = [...targetVal, ...sourceVal];
          } else {
            result[key] = sourceVal;
          }
        } else {
          // Objects: recursive merge
          if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
            result[key] = this.deepMerge(targetVal, sourceVal);
          } else {
            result[key] = sourceVal;
          }
        }
      } else {
        // Primitives: source overrides target
        result[key] = sourceVal;
      }
    }
    
    return result;
  }
  
  /**
   * Handle errors during file operations
   */
  private async handleError(filePath: string, fileInfo: FileStreamInfo, error: unknown): Promise<void> {
    console.error(`[ERROR] [Render] Error completing ${fileInfo.actionType} for ${filePath}:`);
    
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error:`, error);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // ✅ Send file operation failed status to UI (FileCard will display this)
    const failedType = fileInfo.actionType === 'create' ? 'file_create_failed' : 'file_delete_failed';
    
    await this.chatAPI.showChatStatus(failedType as any, {
      filePath,
      reason: errorMessage
    });
    
    // ❌ DO NOT send generic error event - it causes duplicate error display
    // FileCard already shows the error with red styling and error message
  }
  
  /**
   * Schedule a debounced file tree notification via Redis Pub/Sub.
   * Batches rapid consecutive writes into a single notification (2s debounce).
   */
  private scheduleFileTreeNotification(): void {
    if (!this.fileTreeUpdate) return;
    
    const projectId = process.env.ANT_PROJECT_ID;
    const featureName = process.env.ANT_FEATURE_NAME;
    if (!projectId || !featureName) {
      console.warn(`[FileRenderer] Cannot notify file tree: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
      return;
    }
    
    if (this.fileTreeNotifyTimer) clearTimeout(this.fileTreeNotifyTimer);
    this.fileTreeNotifyTimer = setTimeout(() => {
      this.fileTreeUpdate!.notifyFileTreeUpdate(projectId, featureName);
      this.fileTreeNotifyTimer = null;
    }, FileRenderer.FILE_TREE_NOTIFY_DEBOUNCE_MS);
  }
  
  /**
   * Flush any pending debounced file tree notification immediately.
   * Called when streaming completes to ensure the final state is broadcast.
   */
  flushFileTreeNotification(): void {
    if (this.fileTreeNotifyTimer) {
      clearTimeout(this.fileTreeNotifyTimer);
      this.fileTreeNotifyTimer = null;
      if (this.fileTreeUpdate) {
        const projectId = process.env.ANT_PROJECT_ID;
        const featureName = process.env.ANT_FEATURE_NAME;
        if (!projectId || !featureName) {
          console.warn(`[FileRenderer] Cannot flush file tree notify: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
          return;
        }
        this.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
      }
    }
    
    // ✅ Flush pending unseen artifact notifications
    this.flushUnseenArtifacts();
  }
  
  /**
   * Flush accumulated unseen artifact paths via FileTreeBroadcaster.
   */
  private flushUnseenArtifacts(): void {
    if (this.pendingUnseenPaths.size === 0) return;
    if (!this.fileTreeUpdate || !('addUnseenArtifacts' in this.fileTreeUpdate)) return;
    
    const projectId = process.env.ANT_PROJECT_ID;
    const featureName = process.env.ANT_FEATURE_NAME;
    if (!projectId || !featureName) return;
    
    const paths = Array.from(this.pendingUnseenPaths);
    this.pendingUnseenPaths.clear();
    
    (this.fileTreeUpdate as any).addUnseenArtifacts(projectId, featureName, paths)
      .catch((err: any) => console.warn(`[FileRenderer] Failed to flush unseen artifacts: ${err.message}`));
  }
  
  /**
   * Cleanup resources for a file
   */
  private cleanup(filePath: string): void {
    this.activeFiles.delete(filePath);
    this.lineBuffers.clear(filePath);
    this.completionPromises.delete(filePath);
    this.completionResolvers.delete(filePath);
    this.completionRejectors.delete(filePath);
  }
  
  /**
   * Wait for all file operations to complete
   * ✅ This must be called BEFORE marking task as completed
   * ✅ CRITICAL: Generate violations for incomplete operations (missing closing tags)
   */
  async waitForAllFileOperations(): Promise<void> {
    // ✅ CRITICAL: Check for incomplete operations (activeFiles without closing tags)
    // This happens when LLM starts <file> but never sends </file>
    // For feature tasks, this is the ONLY error detection mechanism (no validation phase)
    if (this.activeFiles.size > 0) {
      console.warn(`⚠️  [FileRenderer] ${this.activeFiles.size} incomplete file operation(s) detected!`);
      
      for (const [filePath, fileInfo] of this.activeFiles) {
        console.error(`   - ${fileInfo.actionType}: ${filePath} (missing closing tag)`);
        
        // ✅ Create violation for self-healing (REQUIRED for feature tasks)
        const errorMsg = `⚠️ File operation incomplete: <${fileInfo.actionType}> tag for "${filePath}" was never closed.\n` +
          `\n` +
          `CRITICAL: You MUST close ALL XML tags before outputting <done>!\n` +
          `\n` +
          `❌ WRONG:\n` +
          `<file path="App.tsx">\n` +
          `content...\n` +
          `<done>true</done>  ← Missing </file>!\n` +
          `\n` +
          `✅ CORRECT:\n` +
          `<file path="App.tsx">\n` +
          `content...\n` +
          `</file>  ← Close tag FIRST!\n` +
          `<done>true</done>  ← Then output done`;
        
        this.fileErrors.push(errorMsg);
        
        // ✅ Resolve promise to allow workflow to continue (violation will trigger retry)
        const resolver = this.completionResolvers.get(filePath);
        if (resolver) {
          resolver();
        }
        
        this.cleanup(filePath);
      }
    }
    
    const pendingOperations = Array.from(this.completionPromises.values());
    
    if (pendingOperations.length === 0) {
      console.log(`✅ [FileRenderer] No file operations pending, proceeding immediately`);
      return;
    }
    
    console.log(`⏳ [FileRenderer] Waiting for ${pendingOperations.length} file operation(s) to complete...`);
    
    try {
      await Promise.all(pendingOperations);
      console.log(`✅ [FileRenderer] All file operations completed`);
    } catch (error) {
      // ✅ File operation errors are non-blocking (recorded in fileErrors)
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`⚠️  [FileRenderer] File operation error (non-blocking): ${errorMsg}`);
      // Don't re-throw - errors are already in fileErrors for self-healing
    }
  }
  
  /**
   * Check if there are active file operations
   */
  hasActiveFiles(): boolean {
    return this.activeFiles.size > 0;
  }
  
  /**
   * Finalize all pending file operations
   * ⚠️ CRITICAL: Do NOT save incomplete files (missing closing tags)
   */
  async finalize(): Promise<void> {
    for (const [filePath, fileInfo] of this.activeFiles) {
      console.warn(`⚠️  [Render] Incomplete operation detected: ${fileInfo.actionType} on ${filePath}`);
      console.warn(`   Missing closing tag: </${fileInfo.actionType === 'create' ? 'file' : fileInfo.actionType}>`);
      console.warn(`   File will NOT be saved to prevent corruption.`);
      
      // ❌ Do NOT save incomplete files
      // ✅ But notify UI that operation was cancelled
      const completePhase = 'complete' as const;
      const completeType = fileInfo.actionType === 'create' ? 'file_create' :
                          fileInfo.actionType === 'delete' ? 'file_delete' : null;
      
      if (completeType) {
        await this.chatAPI.sendLLMEvent({
          type: completeType,
          metadata: { placeholder: true }
        } as any);  // ✅ Type cast for UI event without filePath field
      }
      
      // ✅ CRITICAL: Resolve (not reject!) completion promise for incomplete files
      // Missing closing tag is a violation (retryable), not a crash-worthy error
      // Error is already recorded in self-healing message above
      const resolver = this.completionResolvers.get(filePath);
      if (resolver) {
        resolver();  // ✅ Resolve to allow workflow to continue (violation will be handled)
      }
    }
    
    this.activeFiles.clear();
    this.lineBuffers.clearAll();
    this.completionPromises.clear();
    
    // ✅ Flush pending file tree notification on finalize
    this.flushFileTreeNotification();
  }
  
  /**
   * Get all file operation errors
   */
  getFileErrors(): string[] {
    return this.fileErrors;
  }

  /**
   * Get cross-worker file conflicts with structured data for direct merge.
   * These are NOT included in fileErrors — execute handles them directly
   * by injecting both contents into the conversation (1 LLM call instead of 4-5).
   */
  getFileConflicts(): FileConflict[] {
    return this.fileConflicts;
  }
  
  /**
   * Reset state for stream retry
   * ✅ CRITICAL: Called when API stream fails and retries
   * Clears incomplete file operations to prevent false "missing closing tag" errors
   */
  reset(): void {
    // Log incomplete files that will be discarded
    if (this.activeFiles.size > 0) {
      console.log(`[FileRenderer] 🔄 Resetting ${this.activeFiles.size} incomplete file operation(s) for retry`);
      for (const [filePath] of this.activeFiles) {
        console.log(`   - Discarding incomplete: ${filePath}`);
      }
    }
    
    this.activeFiles.clear();
    this.lineBuffers.clearAll();
    this.completionPromises.clear();
    this.completionResolvers.clear();
    this.completionRejectors.clear();
    this.fileErrors = [];
    this.fileConflicts = [];
    
    // ✅ Cancel pending file tree notification on reset
    if (this.fileTreeNotifyTimer) {
      clearTimeout(this.fileTreeNotifyTimer);
      this.fileTreeNotifyTimer = null;
    }
  }
}
