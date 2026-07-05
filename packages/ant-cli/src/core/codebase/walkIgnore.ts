/**
 * CODEBASE_WALK_IGNORE — single SSOT for directory/file names that must never
 * be walked into the RAC pool or the codebase manifest.
 *
 * Installed dependencies / build output (`node_modules`, `dist`, `.next`, …)
 * are enormous by file COUNT. Even stub/compaction can only shrink per-file
 * SIZE, so a directory walk that includes them explodes the prompt regardless
 * of compaction (the `fern-grading-knife` 7.85M-token decompose crash: 22,131
 * node_modules files → 9.8M chars of stubs). This list previously lived,
 * duplicated and drifting, in `decompose/index.ts`, `plan/rag/combine.ts`,
 * `CodebaseIndexer.ts`, `FileTreeBroadcaster.ts`, … — consolidated here.
 */

/** Directory names never worth walking into the RAC pool / codebase manifest. */
export const CODEBASE_WALK_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'vendor', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.output', 'coverage', '.turbo', '.cache',
  '.venv', 'venv', 'target',
]);

/** File suffixes skipped during a codebase walk (lockfiles / checksum files). */
export const CODEBASE_WALK_IGNORE_FILE_SUFFIXES: readonly string[] = ['.lock', '.sum'];

/**
 * Flat exclude list for `fileSystem.listFiles(path, exclude)` call sites
 * (name/substring matched by the adapter).
 */
export const CODEBASE_WALK_IGNORE: readonly string[] = [
  ...CODEBASE_WALK_IGNORE_DIRS,
  '*.lock', '*.sum',
];

export function isIgnoredWalkDir(name: string): boolean {
  return CODEBASE_WALK_IGNORE_DIRS.has(name);
}

export function isIgnoredWalkFile(name: string): boolean {
  return CODEBASE_WALK_IGNORE_FILE_SUFFIXES.some(sfx => name.endsWith(sfx));
}
