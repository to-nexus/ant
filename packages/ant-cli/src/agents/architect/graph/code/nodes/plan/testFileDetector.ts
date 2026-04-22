import * as fs from 'fs';
import * as path from 'path';

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /_test\.go$/,
];

/**
 * Scan the codebase directory on disk for test files.
 * Authoritative disk-based detector — reflects writes from the current run.
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
