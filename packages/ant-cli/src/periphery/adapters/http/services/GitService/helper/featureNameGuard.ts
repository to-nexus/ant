import { validateFeatureName } from '@ant/shared';
import { GitConfigError } from '../errors';

/**
 * BE-side feature-name enforcement. Branch name == feature name, so names
 * must satisfy git branch rules (shared validator `validateFeatureName`).
 * Throws `GitConfigError` (HTTP 400) with the specific violation.
 */
export function assertValidFeatureName(name: string): void {
  const check = validateFeatureName(name);
  if (check.ok) return;
  throw new GitConfigError(
    `Invalid feature name "${name}" (${check.violation}) — feature names become git branch names: ` +
      `letters, digits, ".", "_", "-" and "/" (git-style nesting); no spaces, no "~"`,
    { retryable: false }
  );
}
