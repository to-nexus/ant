/**
 * GitBadge — 3-state indicator reused across ConfigField / Wizard /
 * StepGitIntegration.
 *
 * Derived from {@link deriveGitBadge}. Never reads `gitStatus` /
 * `gitChanges` / `remoteUrl` fields directly.
 */

import { CircleCheck, CircleDashed, Circle } from 'lucide-react';
import type { GitBadge as GitBadgeState } from '../../domain/git-world';

export interface GitBadgeProps {
  state: GitBadgeState;
  /** Optional compact rendering for narrow fields. */
  compact?: boolean;
}

export function GitBadge({ state, compact }: GitBadgeProps) {
  if (state.kind === 'none') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <Circle className="h-3 w-3" />
        {compact ? '—' : 'No repository'}
      </span>
    );
  }

  if (state.kind === 'notConfigured') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <CircleDashed className="h-3 w-3" />
        {compact ? 'Setup' : 'Not configured'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="h-3 w-3" />
      {compact ? (state.branch ?? 'OK') : state.branch ?? 'Connected'}
    </span>
  );
}
