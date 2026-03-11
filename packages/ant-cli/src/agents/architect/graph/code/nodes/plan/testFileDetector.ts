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
