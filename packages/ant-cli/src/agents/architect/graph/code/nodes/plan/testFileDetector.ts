import * as fs from 'fs';
import * as path from 'path';
import { ProjectCodeContext } from '../../../../../../core/prompt/types/CodeContext';

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /_test\.go$/,
];

/**
 * Detect whether the project contains test files.
 * Checks filePaths first (structured list), falls back to directoryTree string match.
 * Returns false (conservative: tests not required) when neither source is available.
 */
export function detectTestFiles(ctx?: ProjectCodeContext): boolean {
  if (ctx?.filePaths?.length) {
    return ctx.filePaths.some(fp =>
      TEST_FILE_PATTERNS.some(p => p.test(fp))
    );
  }
  if (ctx?.directoryTree) {
    return TEST_FILE_PATTERNS.some(p => p.test(ctx.directoryTree!));
  }
  return false;
}

/**
 * Scan the codebase directory on disk for test files.
 * More reliable than detectTestFiles(projectCodeContext) which uses a RAG snapshot
 * loaded at job start — misses test files written during execution.
 */
export function detectTestFilesFromDisk(featurePath?: string): boolean {
  if (!featurePath) return false;
  const codebasePath = path.join(featurePath, 'codebase');
  return scanDirForTests(codebasePath);
}

function scanDirForTests(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      if (scanDirForTests(path.join(dir, entry.name))) return true;
    } else if (TEST_FILE_PATTERNS.some(p => p.test(entry.name))) {
      return true;
    }
  }
  return false;
}
