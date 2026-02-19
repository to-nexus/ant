/**
 * Canonical Feature Directories (Frontend Mirror)
 *
 * Must stay in sync with CANONICAL_FEATURE_DIRS in
 * packages/ant-cli/src/core/utils/sessionPaths.ts
 *
 * Canonical directories are system-managed and never fully deleted —
 * only their contents are cleared ("내용 비우기") while preserving structure.
 */

const CANONICAL_FEATURE_DIRS: ReadonlySet<string> = new Set([
  'inputs',
  'inputs/sources',
  'inputs/directives',
  'inputs/directives/design',
  'inputs/directives/code',
  'inputs/directives/learn',
  'inputs/assets',
  'inputs/references',
  'outputs',
  'outputs/design',
  'outputs/evals',
  'outputs/evals/prd',
  'outputs/evals/ui-design',
  'outputs/evals/system-design',
  'outputs/evals/code',
  'sessions',
  'sessions/architect',
  'sessions/architect/debug',
  'sessions/architect/debug/prompts',
  'sessions/architect/debug/plans',
  'sessions/architect/debug/keywords',
  'sessions/architect/debug/logs',
  'sessions/architect/debug/tokens',
  'sessions/architect/debug/asks',
  'sessions/planner',
  'sessions/planner/debug',
  'sessions/planner/debug/prompts',
]);

/**
 * Check if a path (relative to feature root) is a canonical directory.
 * Canonical directories show "내용 비우기" (Clear Contents) instead of "삭제" (Delete).
 */
export function isCanonicalDir(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
  return CANONICAL_FEATURE_DIRS.has(normalized);
}
