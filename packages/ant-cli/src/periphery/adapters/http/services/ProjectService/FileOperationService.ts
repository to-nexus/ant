import * as fs from 'fs';
import * as path from 'path';
import type { FileNode, FileResource } from '@ant/shared';
import { isFeatureTreeRootEntry } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { assertWithinRoot } from '../../../../../core/config/pathContainment';
import { UserContext } from '../../../../../core/types/user';
import { isCanonicalDir, clearCanonicalDirectory, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import {
  buildUniversalMergedTree,
  decorateUniversalTree,
  resolveUniversalContainerPath,
  resolveUniversalMergedPath,
} from '../../../../../core/customAgents/universalContainer';
import { normalizeTemplateDoc } from '../../../../../core/utils/templateDetector';
import { computeFileMeta, shouldEvaluateTemplate } from '../../../../../core/utils/computeFileMeta';
import { isBinaryPath, isBinaryFileSync, sniffFile } from '../../../../../core/utils/binaryExtensions';
import { writeBufferVerifiedAbs } from '../../../../../core/utils/binaryIntegrity';
import {
  toBaseRelative,
  statContainedBase,
  readTextContainedBase,
  writeTextContainedBase,
  mkdirpContainedBase,
  sniffContainedBase,
  unlinkContainedBase,
  rmrfContainedBase,
  readdirContainedBase,
  type BaseRelative,
} from '../../../../../core/config/containedIo';

/**
 * Thrown when the text file API is pointed at binary content. Routes map it
 * to HTTP 422 so the FE can distinguish it from real failures.
 * - 'BINARY_FILE'   — read refused (use /files-raw/)
 * - 'BINARY_TARGET' — write refused (binary enters via the upload route only)
 */
export class BinaryFileOperationError extends Error {
  readonly code: 'BINARY_FILE' | 'BINARY_TARGET';
  readonly size?: number;

  constructor(code: 'BINARY_FILE' | 'BINARY_TARGET', filePath: string, size?: number) {
    super(
      code === 'BINARY_FILE'
        ? `Binary file cannot be read as text: ${filePath}`
        : `Binary file cannot be written via the text file API: ${filePath}`,
    );
    this.code = code;
    this.size = size;
  }
}

/**
 * Blacklist for depth ≥ 1 only. The feature root is governed by the
 * `isFeatureTreeRootEntry` allowlist, which already excludes `codebase/`
 * (not a canonical dir) and everything else that is not an artifact domain.
 */
const TREE_EXCLUDE = new Set([
  'node_modules',
  'dist',
  'build',
  '__pycache__',
]);

/**
 * Single-scan budget for the canonical file tree (M-009). Sized well above any
 * real feature so normal trees are unaffected; a hostile wide/deep tree stops at
 * the cap with a partial result instead of walking unbounded on the shared API.
 */
const CANONICAL_TREE_MAX_ENTRIES = 20_000;
const CANONICAL_TREE_MAX_DEPTH = 32;

/**
 * FileOperationService
 * 
 * Handles file and directory operations within features.
 * 
 * Every file-meta surface (tree / read / write) routes template state
 * computation through `computeFileMeta` — there is no inline duplication.
 * 
 * Deletion / clearing behavior:
 * - Canonical directories (defined in CANONICAL_FEATURE_DIRS): contents cleared,
 *   directory structure preserved. Non-canonical subdirectories within are fully removed.
 * - Non-canonical directories (user-created): fully deleted (rm -rf).
 */
export class FileOperationService {
  private readonly workspaceResolver: WorkspaceResolver;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * @deprecated Use clearCanonicalDirectory() from sessionPaths.ts directly.
   * Kept as a thin wrapper for backward compatibility within this class.
   */
  private async smartClearDirectory(dirPath: string, relativePath: string): Promise<void> {
    return clearCanonicalDirectory(dirPath, relativePath);
  }

  /**
   * Universal seam: when `featureName` is the universal pseudo-feature on a
   * universal-type project, file paths resolve against the container's merged
   * view (`artifacts/**` + grafted `sessions/**`) instead of `features/…`.
   * Null on canonical projects — every existing path is untouched.
   */
  private resolveUniversalContainer(projectId: string, featureName: string, userContext: UserContext): string | null {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    return resolveUniversalContainerPath(projectPath, featureName);
  }

  /**
   * A base-relative descent handle for `fullPath`, anchored at the service-owned
   * physical workspace base — `undefined` when the path is outside that base
   * (`repoType:'local'`), where the caller keeps its legacy single-trust path.
   * Every read/write/delete below binds through this instead of re-opening the
   * resolved name (H-017 / M-026 / M-NEW-024).
   */
  private baseRelOf(fullPath: string): BaseRelative | undefined {
    return toBaseRelative(this.workspaceResolver.getPhysicalWorkspacesPath(), fullPath);
  }

  private resolveFullPath(projectId: string, featureName: string, filePath: string, userContext: UserContext): { featurePath: string; fullPath: string } {
    const containerPath = this.resolveUniversalContainer(projectId, featureName, userContext);
    if (containerPath) {
      return { featurePath: containerPath, fullPath: resolveUniversalMergedPath(containerPath, filePath) };
    }
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    // Traversal + symlink-redirect guard (shared SSOT with the route-level
    // raw/download handlers, which bypass this service).
    let fullPath: string;
    try {
      fullPath = assertWithinRoot(featurePath, filePath);
    } catch {
      throw new Error('Invalid file path');
    }
    return { featurePath, fullPath };
  }
  
  /**
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<FileNode[]> {
    // Universal seam: merged container view, no canonical-feature scaffolding.
    // FileNode meta computation is preserved so fileSlice.refreshFileTree /
    // stale detection / the Redis tree cache stay shape-compatible.
    const containerPath = this.resolveUniversalContainer(projectId, featureName, userContext);
    if (containerPath) {
      return decorateUniversalTree(buildUniversalMergedTree(containerPath));
    }

    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    // Reconcile canonical dirs/files for existing features (retroactive for newly added entries)
    await ensureCanonicalStructure(featurePath);

    // Bound a single scan: an attacker-authored wide/deep tree would otherwise
    // walk unbounded, holding the shared API's filesystem/CPU/heap (M-009). Every
    // raw Dirent charges the budget (hidden entries included) and depth is capped;
    // over-budget stops descending rather than throwing (partial tree, no crash).
    const budget = { entries: CANONICAL_TREE_MAX_ENTRIES };

    const buildTree = async (dirPath: string, relativePath: string = '', depth = 0): Promise<FileNode[]> => {
      if (depth > CANONICAL_TREE_MAX_DEPTH || budget.entries <= 0) return [];
      // Contained enumeration: on the multi-tenant base the readdir/stat/read
      // below bind through a descent, so a reparented intermediate directory
      // cannot leak another tenant's entry names or bytes into the tree (H-017 /
      // M-NEW-005). Out-of-base (local) keeps the raw walk.
      const dirBr = this.baseRelOf(dirPath);
      let items: Array<{ name: string; isDir: boolean }> = [];
      if (dirBr) {
        const listed = readdirContainedBase(dirBr);
        if (!listed.ok) return [];
        items = listed.entries
          .filter((e) => !e.isSymbolicLink)
          .map((e) => ({ name: e.name, isDir: e.isDirectory }));
      } else {
        try {
          items = (await fs.promises.readdir(dirPath, { withFileTypes: true }))
            .map((d) => ({ name: d.name, isDir: d.isDirectory() }));
        } catch {
          return [];
        }
      }

      if (items.length === 0) {
        return [];
      }

      // Charge every raw entry (pre-filter) so hidden/excluded names cannot make
      // a wide directory free to enumerate.
      budget.entries -= items.length;
      if (budget.entries < 0) {
        items = items.slice(0, Math.max(0, items.length + budget.entries));
      }

      const sorted = items
        .filter(d => (relativePath === ''
          ? isFeatureTreeRootEntry(d.name)
          : !d.name.startsWith('.') && !TREE_EXCLUDE.has(d.name)))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      const tree: FileNode[] = [];
      for (const item of sorted) {
        const fullPath = path.join(dirPath, item.name);
        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDir) {
          const children = await buildTree(fullPath, itemRelativePath, depth + 1);
          tree.push({
            name: item.name,
            path: itemRelativePath,
            type: 'directory',
            children,
          });
          continue;
        }

        let size = 0;
        let mtimeMs = 0;
        let content: string | null = null;
        const fileBr = this.baseRelOf(fullPath);
        if (fileBr) {
          const st = statContainedBase(fileBr);
          if (st.ok) { size = Number(st.stat.size); mtimeMs = Number(st.stat.mtimeMs); }
          if (shouldEvaluateTemplate(itemRelativePath)) {
            const read = readTextContainedBase(fileBr);
            if (read.ok) content = read.text;
          }
        } else {
          try {
            const stats = await fs.promises.stat(fullPath);
            size = stats.size;
            mtimeMs = stats.mtimeMs;
          } catch { /* skip stat failures */ }
          if (shouldEvaluateTemplate(itemRelativePath)) {
            try {
              content = await fs.promises.readFile(fullPath, 'utf-8');
            } catch { /* skip read failures */ }
          }
        }

        const meta = computeFileMeta({
          relativePath: itemRelativePath,
          content,
          size,
          mtime: mtimeMs,
        });

        tree.push({
          name: item.name,
          path: itemRelativePath,
          type: 'file',
          meta,
        });
      }

      return tree;
    };

    try {
      const tree = await buildTree(featurePath);
      if (tree.length === 0) {
        return [{
          name: path.basename(featurePath),
          path: '',
          type: 'directory',
          children: [],
        }];
      }
      return tree;
    } catch (error) {
      console.error('[FileOperationService] Error building file tree:', error);
      return [{
        name: path.basename(featurePath),
        path: '',
        type: 'directory',
        children: [],
      }];
    }
  }
  
  /**
   * Read file as a FileResource (content + ground-truth meta).
   *
   * Binary files are refused (`code: 'BINARY_FILE'` → HTTP 422): decoding
   * them as utf-8 is lossy (every invalid byte → U+FFFD), and a subsequent
   * save round-trips the replacement chars back to disk, destroying the
   * file. Binary reads go through `/files-raw/` instead.
   */
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);
    const br = this.baseRelOf(fullPath);

    if (br) {
      // Contained: the sniff, the size and the bytes come from the same descended
      // descriptor — a component swapped after resolve is refused (H-017).
      const st = statContainedBase(br);
      if (!st.ok) throw new Error(`Invalid file path: ${filePath}`);
      if (st.stat.isFile()) {
        const sniff = sniffContainedBase(br);
        if (sniff.ok && sniff.binary) {
          throw new BinaryFileOperationError('BINARY_FILE', filePath, sniff.size);
        }
      }
      const read = readTextContainedBase(br);
      if (!read.ok) throw new Error(`Invalid file path: ${filePath}`);
      const meta = computeFileMeta({
        relativePath: filePath,
        content: read.text,
        size: read.size,
        mtime: Number(st.stat.mtimeMs),
      });
      return { projectId, featureName, path: filePath, content: read.text, meta };
    }

    const stats = await fs.promises.stat(fullPath);
    if (stats.isFile()) {
      const sniff = sniffFile(fullPath);
      if (sniff.binary) {
        throw new BinaryFileOperationError('BINARY_FILE', filePath, sniff.size ?? stats.size);
      }
    }

    const content = await fs.promises.readFile(fullPath, 'utf-8');

    const meta = computeFileMeta({
      relativePath: filePath,
      content,
      size: stats.size,
      mtime: stats.mtimeMs,
    });

    return { projectId, featureName, path: filePath, content, meta };
  }
  
  /**
   * Write file content and return the ground-truth FileResource (normalized
   * content + recomputed meta). This is the single mutation surface for text
   * files; HTTP PUT routes MUST delegate here.
   *
   * Binary targets are refused (`code: 'BINARY_TARGET'` → HTTP 422): a
   * string body re-encoded as utf-8 destroys binary content (the Duck.glb
   * mojibake incident — U+FFFD round-trip). Binary files enter only via the
   * Buffer-safe upload route.
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);
    const br = this.baseRelOf(fullPath);

    let finalContent = content;
    if (filePath.startsWith('plan/')) {
      const normalized = normalizeTemplateDoc(content);
      if (normalized !== null) {
        finalContent = normalized;
      }
    }

    if (br) {
      // M-026: the binary gate, the parent mkdir, the write and the size all
      // resolve through the same descended base — a symlink swapped into an
      // intermediate directory after the lexical check cannot redirect the write
      // outside the feature root. `isBinaryPath` is a pure name check (no I/O);
      // the content sniff binds a descriptor when the file already exists.
      if (isBinaryPath(filePath)) {
        throw new BinaryFileOperationError('BINARY_TARGET', filePath);
      }
      const existing = sniffContainedBase(br);
      if (existing.ok && existing.binary) {
        throw new BinaryFileOperationError('BINARY_TARGET', filePath);
      }
      const parent = this.baseRelOf(path.dirname(fullPath));
      if (parent) {
        const made = mkdirpContainedBase(parent);
        if (!made.ok) throw new Error(`Invalid file path: ${filePath}`);
      }
      const written = writeTextContainedBase(br, finalContent);
      if (!written.ok) throw new Error(`Invalid file path: ${filePath}`);
      const st = statContainedBase(br);
      const meta = computeFileMeta({
        relativePath: filePath,
        content: finalContent,
        size: st.ok ? Number(st.stat.size) : Buffer.byteLength(finalContent),
        mtime: st.ok ? Number(st.stat.mtimeMs) : Date.now(),
      });
      return { projectId, featureName, path: filePath, content: finalContent, meta };
    }

    if (isBinaryPath(filePath) || isBinaryFileSync(fullPath)) {
      throw new BinaryFileOperationError('BINARY_TARGET', filePath);
    }

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, finalContent, 'utf-8');

    const stats = await fs.promises.stat(fullPath);
    const meta = computeFileMeta({
      relativePath: filePath,
      content: finalContent,
      size: stats.size,
      mtime: stats.mtimeMs,
    });

    return { projectId, featureName, path: filePath, content: finalContent, meta };
  }
  
  /**
   * Delete a file or clear a directory's contents.
   * - Canonical directories: clear contents (preserve structure, remove files and non-canonical subdirs)
   * - Non-canonical directories: fully deleted
   * - Files: deleted
   */
  async deleteFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<void> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);
    const br = this.baseRelOf(fullPath);

    if (br) {
      // Contained delete: the leaf and every entry removed under a cleared
      // canonical dir are addressed through descended descriptors, so a
      // directory component swapped for a symlink after resolve cannot redirect
      // the rm outside the feature root (H-017).
      const st = statContainedBase(br);
      if (!st.ok) {
        if (st.reason === 'missing') return; // already gone
        throw new Error(`Invalid file path: ${filePath}`);
      }
      if (st.stat.isDirectory()) {
        if (isCanonicalDir(filePath)) {
          this.clearCanonicalContained(br, filePath);
          console.log(`[FileOperationService] Cleared contents: ${filePath}`);
        } else {
          const res = rmrfContainedBase(br);
          if (!res.ok) throw new Error(`Invalid file path: ${filePath}`);
          console.log(`[FileOperationService] Deleted: ${filePath}`);
        }
      } else {
        const res = unlinkContainedBase(br);
        if (!res.ok && res.reason !== 'missing') throw new Error(`Invalid file path: ${filePath}`);
      }
      return;
    }

    const stat = await fs.promises.stat(fullPath);

    if (stat.isDirectory()) {
      if (isCanonicalDir(filePath)) {
        await this.smartClearDirectory(fullPath, filePath);
        console.log(`[FileOperationService] Cleared contents: ${filePath}`);
      } else {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        console.log(`[FileOperationService] Deleted: ${filePath}`);
      }
    } else {
      await fs.promises.unlink(fullPath);
    }
  }

  /**
   * Contained twin of `clearCanonicalDirectory`: clears a canonical directory's
   * contents while preserving canonical subdirectory structure — canonical
   * subdirs are recursed, non-canonical entries are removed — with every readdir
   * and rm addressed through a base descent (H-017). `relFromBase` and
   * `relFromFeature` diverge because canonical-ness is judged on the feature-
   * relative path while the descent is anchored at the physical base.
   */
  private clearCanonicalContained(dir: BaseRelative, featureRelPath: string): void {
    const listed = readdirContainedBase(dir);
    if (!listed.ok) return; // missing/failed: nothing to clear
    for (const entry of listed.entries) {
      const childBaseRel: BaseRelative = { base: dir.base, relative: `${dir.relative}/${entry.name}` };
      const childFeatureRel = `${featureRelPath}/${entry.name}`;
      if (entry.isSymbolicLink) {
        // Remove the link itself (never followed) rather than its target.
        unlinkContainedBase(childBaseRel);
      } else if (entry.isDirectory) {
        if (isCanonicalDir(childFeatureRel)) {
          this.clearCanonicalContained(childBaseRel, childFeatureRel);
        } else {
          rmrfContainedBase(childBaseRel);
        }
      } else {
        unlinkContainedBase(childBaseRel);
      }
    }
  }
  
  /**
   * Upload multiple files
   */
  async uploadFiles(
    projectId: string,
    featureName: string,
    files: Array<{ path: string; content: Buffer }>,
    userContext: UserContext
  ): Promise<void> {
    for (const file of files) {
      const { featurePath, fullPath } = this.resolveFullPath(projectId, featureName, file.path, userContext);
      await writeBufferVerifiedAbs(featurePath, fullPath, file.content);
    }
  }
}
