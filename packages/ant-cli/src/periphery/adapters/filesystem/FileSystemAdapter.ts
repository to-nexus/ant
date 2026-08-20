/**
 * FileSystemAdapter
 * 
 * POSIX-compatible filesystem implementation of FileSystemPort.
 * Works with local filesystem and AWS EFS (any POSIX mount).
 * Provides isolated file access scoped to a base directory.
 * 
 * Security features:
 * - Path traversal protection
 * - Workspace isolation
 * - Accepts both relative and absolute paths (absolute must be within workspace)
 * 
 * Works with any POSIX-compatible filesystem (local, EFS).
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileSystemPort } from '../../../core/ports/filesystem';
import {
  mkdirpContained,
  readTextContained,
  writeTextContained,
  readTextContainedBase,
  readBufferContainedBase,
  writeBufferContainedBase,
  mkdirpContainedBase,
  unlinkContainedBase,
  renameContainedBase,
  rmrfContainedBase,
  statContainedBase,
  toBaseRelative,
  type BaseRelative,
} from '../../../core/config/containedIo';
import { WorkspacePathResolver } from '../../../core/config/WorkspacePathResolver';
import { isBinaryPath } from '../../../core/utils/binaryExtensions';

export class FileSystemAdapter implements FileSystemPort {
  private readonly basePath: string;

  constructor(basePath: string) {
    // Normalize base path (remove trailing slash, resolve absolute)
    this.basePath = path.resolve(basePath);

    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Express an absolute in-workspace path as a base-relative descent target
   * anchored at the service-owned physical workspace base. Every read and
   * mutation below routes through this so the feature-name components are
   * descended O_NOFOLLOW and a reparented root cannot redirect the operation
   * (M-NEW-005, M-NEW-019). Returns `undefined` for paths outside the
   * multi-tenant base (`repoType:'local'`, explicit external roots), which keep
   * the raw fs path — the single-developer trust boundary.
   */
  private baseRel(fullPath: string): BaseRelative | undefined {
    return toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), fullPath);
  }
  
  /**
   * Resolve a workspace-relative path to an absolute filesystem path.
   * Accepts both relative paths and absolute paths within the workspace boundary.
   *
   * Public so callers that must talk to APIs requiring absolute paths
   * (`child_process.spawn` cwd, native binaries, etc.) can share the
   * same traversal-protected resolution as the file operations below.
   *
   * @throws Error if path resolves outside the workspace (traversal protection)
   */
  resolveAbsolute(inputPath: string): string {
    if (path.isAbsolute(inputPath)) {
      const normalized = path.normalize(inputPath);
      if (normalized === this.basePath || normalized.startsWith(this.basePath + path.sep)) {
        return normalized;
      }
      throw new Error(
        `Path traversal detected: "${inputPath}" resolves outside workspace. ` +
        `Workspace: ${this.basePath}, Requested: ${normalized}`
      );
    }

    const fullPath = path.resolve(this.basePath, inputPath);

    if (fullPath !== this.basePath && !fullPath.startsWith(this.basePath + path.sep)) {
      throw new Error(
        `Path traversal detected: "${inputPath}" resolves outside workspace. ` +
        `Workspace: ${this.basePath}, Requested: ${fullPath}`
      );
    }

    return fullPath;
  }
  
  /**
   * Read a workspace file as text.
   *
   * `resolveAbsolute` is a *lexical* test — it compares the resolved string
   * against the base path and so accepts a symlink inside the workspace that
   * points out of it. What this adapter reads goes straight into a model
   * prompt (execute's modify-target section, the `read_file` tool result), so a
   * link to `/proc/1/environ` would put the job worker's live environment into
   * an external provider request (M-NEW-005). The containment SSOT binds the
   * check and the read to one file object and descends by descriptor, so
   * neither a static external link nor a mid-read component swap resolves.
   * Symlinks that stay inside the workspace keep working.
   *
   * Unreadable / escaped / swapped all return `null` — the caller contract is
   * already "missing file → null", and a refused path must not be distinguishable
   * from an absent one.
   */
  async readFile(relativePath: string): Promise<string | null> {
    // Keeps the loud traversal diagnostic for `../` and absolute escapes.
    const fullPath = this.resolveAbsolute(relativePath);

    const br = this.baseRel(fullPath);
    const result = br ? readTextContainedBase(br) : readTextContained(this.basePath, relativePath);
    return result.ok ? result.text : null;
  }
  
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolveAbsolute(relativePath);

    // Single gate for every string-authoring surface (create_file, edit_file,
    // append_file, SharedFileBuffer flush): a utf-8
    // string write to a binary-extension target can only produce garbage or —
    // when the content came from a utf-8 read of real binary — a U+FFFD
    // round-trip that destroys the file (the Duck.glb mojibake incident).
    // Binary files enter the workspace via upload or download_asset only.
    if (isBinaryPath(fullPath)) {
      throw new Error(
        `Cannot write binary file "${relativePath}" via a text tool. ` +
        `Binary assets enter the workspace only through user upload or download_asset; ` +
        `reference the existing file by path instead of authoring or editing its bytes.`
      );
    }

    // Parents and the leaf are both created through the containment SSOT's
    // descriptor descent — the write twin of `readFile` above. A component
    // repointed after the lexical check cannot redirect the write. Base-mode
    // descends the feature-name components too, so the root cannot be reparented
    // (M-NEW-019); out-of-base paths keep the name-anchored helper.
    const br = this.baseRel(fullPath);
    if (br) {
      const parent = path.dirname(br.relative);
      if (parent !== '.' && parent !== '') {
        const made = mkdirpContainedBase({ base: br.base, relative: parent });
        if (!made.ok) throw new Error(`Cannot write "${relativePath}": destination is not writable (${made.reason})`);
      }
      const written = writeBufferContainedBase(br, Buffer.from(content, 'utf8'));
      if (!written.ok) throw new Error(`Cannot write "${relativePath}": destination is not writable (${written.reason})`);
      return;
    }

    const relative = path.relative(this.basePath, fullPath);
    const parent = path.dirname(relative);
    if (parent !== '.' && parent !== '') {
      const made = mkdirpContained(this.basePath, parent);
      if (!made.ok) {
        throw new Error(`Cannot write "${relativePath}": destination is not writable (${made.reason})`);
      }
    }

    const written = writeTextContained(this.basePath, relative, content);
    if (!written.ok) {
      throw new Error(`Cannot write "${relativePath}": destination is not writable (${written.reason})`);
    }
  }
  
  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveAbsolute(relativePath);
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
  
  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = this.resolveAbsolute(relativePath);

    const br = this.baseRel(fullPath);
    if (br) {
      const r = unlinkContainedBase(br);
      if (!r.ok && r.reason !== 'missing') {
        throw new Error(`Cannot delete "${relativePath}" (${r.reason})`);
      }
      return;
    }

    try {
      await fs.promises.unlink(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - no-op
        return;
      }
      throw error;
    }
  }
  
  async readDirectory(relativePath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const fullPath = this.resolveAbsolute(relativePath);
    
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory()
    }));
  }
  
  async createDirectory(relativePath: string): Promise<void> {
    const fullPath = this.resolveAbsolute(relativePath);
    const br = this.baseRel(fullPath);
    if (br) {
      const r = mkdirpContainedBase(br);
      if (!r.ok) throw new Error(`Cannot create directory "${relativePath}" (${r.reason})`);
      return;
    }
    await fs.promises.mkdir(fullPath, { recursive: true });
  }
  
  async listFiles(relativePath: string, exclude: string[] = []): Promise<string[]> {
    const fullPath = this.resolveAbsolute(relativePath);
    
    // Default excludes
    const defaultExcludes = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
    ];
    
    const allExcludes = [...defaultExcludes, ...exclude];
    
    // ✅ Use direct fs.readdirSync (faster and more reliable than glob)
    const results: string[] = [];
    
    const walk = (currentPath: string) => {
      try {
        if (!fs.existsSync(currentPath)) return;
        
        const stat = fs.statSync(currentPath);
        if (!stat.isDirectory()) {
          // If it's a file, add it
          results.push(path.relative(this.basePath, currentPath));
          return;
        }
        
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip hidden files and excluded directories
          if (entry.name.startsWith('.')) continue;
          
          const fullEntryPath = path.join(currentPath, entry.name);
          const relativeEntryPath = path.relative(fullPath, fullEntryPath);
          
          // Check if this path should be excluded
          const shouldExclude = allExcludes.some(pattern => {
            // Simple pattern matching (exact name or contains)
            return relativeEntryPath.includes(pattern) || entry.name === pattern;
          });
          
          if (shouldExclude) continue;
          
          if (entry.isDirectory()) {
            walk(fullEntryPath);
          } else {
            results.push(path.relative(this.basePath, fullEntryPath));
          }
        }
      } catch (error) {
        // Skip directories that can't be read
        return;
      }
    };
    
    walk(fullPath);
    return results;
  }
  
  async isDirectory(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveAbsolute(relativePath);
      const stat = await fs.promises.stat(fullPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
  
  async copyFile(src: string, dest: string, overwrite = true): Promise<void> {
    const srcPath = this.resolveAbsolute(src);
    const destPath = this.resolveAbsolute(dest);

    const srcBr = this.baseRel(srcPath);
    const destBr = this.baseRel(destPath);
    if (srcBr && destBr) {
      // Descriptor-descended read + write; a swapped src/dest root fails closed
      // rather than reading or writing an external file (M-NEW-019).
      const read = readBufferContainedBase(srcBr);
      if (!read.ok) throw new Error(`Source file not found: ${src}`);
      if (!overwrite && statContainedBase(destBr).ok) {
        throw new Error(`Destination file already exists: ${dest}`);
      }
      const parent = path.dirname(destBr.relative);
      if (parent !== '.' && parent !== '') {
        const made = mkdirpContainedBase({ base: destBr.base, relative: parent });
        if (!made.ok) throw new Error(`Cannot copy to "${dest}" (${made.reason})`);
      }
      const written = writeBufferContainedBase(destBr, read.bytes);
      if (!written.ok) throw new Error(`Cannot copy to "${dest}" (${written.reason})`);
      return;
    }

    // Check source exists
    try {
      await fs.promises.access(srcPath);
    } catch {
      throw new Error(`Source file not found: ${src}`);
    }

    // Check overwrite
    if (!overwrite) {
      try {
        await fs.promises.access(destPath);
        throw new Error(`Destination file already exists: ${dest}`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        // ENOENT = file doesn't exist, proceed
      }
    }

    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    // Binary-safe copy using fs.promises.copyFile
    const flags = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
    await fs.promises.copyFile(srcPath, destPath, flags);
  }

  async moveFile(src: string, dest: string, overwrite = true): Promise<void> {
    const srcPath = this.resolveAbsolute(src);
    const destPath = this.resolveAbsolute(dest);

    const srcBr = this.baseRel(srcPath);
    const destBr = this.baseRel(destPath);
    if (srcBr && destBr && srcBr.base === destBr.base) {
      if (!overwrite && statContainedBase(destBr).ok) {
        throw new Error(`Destination file already exists: ${dest}`);
      }
      const parent = path.dirname(destBr.relative);
      if (parent !== '.' && parent !== '') {
        const made = mkdirpContainedBase({ base: destBr.base, relative: parent });
        if (!made.ok) throw new Error(`Cannot move to "${dest}" (${made.reason})`);
      }
      const renamed = renameContainedBase(srcBr.base, srcBr.relative, destBr.relative);
      if (renamed.ok) return;
      // Cross-device / other failure: fall back to descended copy + delete.
      const read = readBufferContainedBase(srcBr);
      if (!read.ok) throw new Error(`Source file not found: ${src}`);
      const written = writeBufferContainedBase(destBr, read.bytes);
      if (!written.ok) throw new Error(`Cannot move to "${dest}" (${written.reason})`);
      unlinkContainedBase(srcBr);
      return;
    }

    // Check source exists
    try {
      await fs.promises.access(srcPath);
    } catch {
      throw new Error(`Source file not found: ${src}`);
    }

    // Check overwrite
    if (!overwrite) {
      try {
        await fs.promises.access(destPath);
        throw new Error(`Destination file already exists: ${dest}`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    try {
      // Try atomic rename (works on same filesystem/mount)
      await fs.promises.rename(srcPath, destPath);
    } catch (error: any) {
      // EXDEV = cross-device link, fall back to copy + delete
      if (error.code === 'EXDEV') {
        await fs.promises.copyFile(srcPath, destPath);
        await fs.promises.unlink(srcPath);
      } else {
        throw error;
      }
    }
  }

  async copyDirectory(src: string, dest: string): Promise<void> {
    const srcPath = this.resolveAbsolute(src);
    const destPath = this.resolveAbsolute(dest);

    // Verify source is a directory
    const srcStat = await fs.promises.stat(srcPath);
    if (!srcStat.isDirectory()) {
      throw new Error(`Source is not a directory: ${src}`);
    }

    // Ensure destination directory exists (descended for in-base targets).
    await this.createDirectory(path.relative(this.basePath, destPath));

    // Recursive merge: iterate source entries, preserve dest-only entries
    const entries = await fs.promises.readdir(srcPath, { withFileTypes: true });

    for (const entry of entries) {
      const srcEntryPath = path.join(srcPath, entry.name);
      const destEntryPath = path.join(destPath, entry.name);

      if (entry.isDirectory()) {
        // Recursive merge for subdirectories
        await this.copyDirectory(
          path.relative(this.basePath, srcEntryPath),
          path.relative(this.basePath, destEntryPath)
        );
      } else {
        // Per-file copy routes through the descended copyFile above.
        await this.copyFile(
          path.relative(this.basePath, srcEntryPath),
          path.relative(this.basePath, destEntryPath),
        );
      }
    }
  }

  async moveDirectory(src: string, dest: string): Promise<void> {
    // Merge copy first, then remove source
    await this.copyDirectory(src, dest);

    const srcPath = this.resolveAbsolute(src);
    const br = this.baseRel(srcPath);
    if (br) {
      const r = rmrfContainedBase(br);
      if (!r.ok && r.reason !== 'missing') throw new Error(`Cannot remove "${src}" (${r.reason})`);
      return;
    }
    await fs.promises.rm(srcPath, { recursive: true, force: true });
  }
  
  getRootPath(): string {
    return this.basePath;
  }
}
