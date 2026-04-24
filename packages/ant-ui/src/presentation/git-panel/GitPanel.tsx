/**
 * GitPanel — the unified Git UI composed from git-world primitives.
 *
 * Replaces the bespoke Git sections previously spread across
 * `ProjectSection`, `GitStatusButton`, `StepGitIntegration`, and
 * `ConfigField`. Selects menu variant via {@link useGitMenu} and delegates
 * rendering to the specialized sub-panels.
 */

import { useGitMenu, useGitBadge } from '../../domain/git-world';
import { GitCta } from './GitCta';
import { GitSetupMenu } from './GitSetupMenu';
import { GitSyncedMenu } from './GitSyncedMenu';
import { GitBadge } from './GitBadge';
import { OperationProgress } from './OperationProgress';

export interface GitPanelProps {
  feature?: string;
  /** GitHub repo URL declared in projectConfig (before disk state). */
  githubRepo: string | null;
  onOpenPatConfig?: () => void;
  onOpenIDE?: () => void;
  onOpenProjectConfig?: () => void;
}

export function GitPanel({
  feature,
  githubRepo,
  onOpenPatConfig,
  onOpenIDE,
  onOpenProjectConfig,
}: GitPanelProps) {
  const menu = useGitMenu(githubRepo);
  const badge = useGitBadge(githubRepo);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBadge state={badge} />
        </div>
        <GitCta feature={feature} disabled={menu.kind === 'loading'} />
      </div>

      {menu.kind === 'setup' && <GitSetupMenu feature={feature} />}
      {menu.kind === 'publish' && (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {menu.source === 'noFeatures'
            ? 'No features yet — create one and publish to GitHub.'
            : 'This branch has no upstream — publish to create it.'}
        </div>
      )}
      {menu.kind === 'synced' && (
        <GitSyncedMenu feature={feature} githubRepo={githubRepo} />
      )}
      {menu.kind === 'disabled' && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {menu.reason === 'noConfig'
            ? 'Configure a GitHub repository to enable Git operations.'
            : 'Git is not initialized for this project.'}
        </div>
      )}

      <OperationProgress
        onOpenPatConfig={onOpenPatConfig}
        onOpenIDE={onOpenIDE}
        onOpenProjectConfig={onOpenProjectConfig}
      />
    </div>
  );
}
