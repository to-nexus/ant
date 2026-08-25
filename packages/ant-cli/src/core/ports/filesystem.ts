/**
 * FileSystemPort
 * 
 * Pure file system operations interface.
 * Separated from GitPort to maintain Single Responsibility Principle.
 * 
 * This port provides workspace-scoped file operations with:
 * - Path traversal protection
 * - Storage backend abstraction (local FS, AWS EFS)
 * - Tenant isolation
 */

/**
 * Thrown by `readFile` when a `maxBytes` budget is set and the opened
 * descriptor's actual size exceeds it. Distinct from the `null` "not found"
 * contract so a caller that bounds the read can tell an oversized file apart
 * from a missing one and surface the right message (M-032). The budget is
 * checked on the SAME descriptor the read binds, so a file grown or swapped
 * after a caller's own pre-stat cannot slip past.
 */
export class FileTooLargeError extends Error {
  constructor(
    readonly relativePath: string,
    readonly size: number | undefined,
    readonly maxBytes: number,
  ) {
    super(`File too large: ${relativePath} exceeds ${maxBytes} bytes`);
    this.name = 'FileTooLargeError';
  }
}

export interface FileReadOptions {
  /**
   * Reject before allocating when the opened descriptor exceeds this many
   * bytes. Enforced against `fstat` on the read's own descriptor — not a
   * path-reopened pre-check — so it holds across a concurrent grow/replace.
   * On exceed, `readFile` throws {@link FileTooLargeError}.
   */
  maxBytes?: number;
}

export interface FileSystemPort {
  /**
   * Read file content
   * @param path - File path (relative to workspace root)
   * @param opts - Optional read budget (see {@link FileReadOptions})
   * @returns File content or null if not found
   * @throws FileTooLargeError if `opts.maxBytes` is set and exceeded
   */
  readFile(path: string, opts?: FileReadOptions): Promise<string | null>;
  
  /**
   * Write file content
   * @param path - File path (relative to workspace root)
   * @param content - File content to write
   */
  writeFile(path: string, content: string): Promise<void>;
  
  /**
   * Check if file exists
   * @param path - File path (relative to workspace root)
   */
  fileExists(path: string): Promise<boolean>;
  
  /**
   * Delete file
   * @param path - File path (relative to workspace root)
   */
  deleteFile(path: string): Promise<void>;
  
  /**
   * Read directory contents
   * @param path - Directory path (relative to workspace root)
   * @returns Array of entries with name and type
   */
  readDirectory(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  
  /**
   * Create directory (recursive)
   * @param path - Directory path (relative to workspace root)
   */
  createDirectory(path: string): Promise<void>;
  
  /**
   * List all files recursively
   * @param path - Directory path (relative to workspace root)
   * @param exclude - Glob patterns to exclude (e.g., ['node_modules', '*.test.ts'])
   * @returns Array of file paths relative to workspace root
   */
  listFiles(path: string, exclude?: string[]): Promise<string[]>;
  
  /**
   * Check if path is a directory
   * @param path - Path (relative to workspace root)
   * @returns true if directory, false if file or not found
   */
  isDirectory(path: string): Promise<boolean>;
  
  /**
   * Copy a single file (binary-safe)
   * @param src - Source file path (relative to workspace root)
   * @param dest - Destination file path (relative to workspace root)
   * @param overwrite - If true (default), overwrite existing file
   */
  copyFile(src: string, dest: string, overwrite?: boolean): Promise<void>;
  
  /**
   * Move a single file
   * Uses rename when possible, falls back to copy+delete.
   * @param src - Source file path (relative to workspace root)
   * @param dest - Destination file path (relative to workspace root)
   * @param overwrite - If true (default), overwrite existing file
   */
  moveFile(src: string, dest: string, overwrite?: boolean): Promise<void>;
  
  /**
   * Copy a directory recursively with merge semantics.
   * - Files in src overwrite files in dest
   * - Files/subdirectories only in dest are preserved
   * @param src - Source directory path (relative to workspace root)
   * @param dest - Destination directory path (relative to workspace root)
   */
  copyDirectory(src: string, dest: string): Promise<void>;
  
  /**
   * Move a directory recursively with merge semantics.
   * Equivalent to copyDirectory + remove source.
   * @param src - Source directory path (relative to workspace root)
   * @param dest - Destination directory path (relative to workspace root)
   */
  moveDirectory(src: string, dest: string): Promise<void>;
  
  /**
   * Get the scope root path for this adapter (featurePath)
   * ⚠️ Do not use for file operations - always use relative paths
   */
  getRootPath(): string;

  /**
   * Resolve a workspace-relative path to an absolute filesystem path,
   * with path-traversal protection. Use this when integrating with APIs
   * that require an absolute path (e.g., `child_process.spawn` cwd,
   * native binaries). For ordinary file operations, prefer the
   * relative-path methods above — they call this internally.
   *
   * @throws Error if the resolved path escapes the workspace boundary.
   */
  resolveAbsolute(relativePath: string): string;
}

