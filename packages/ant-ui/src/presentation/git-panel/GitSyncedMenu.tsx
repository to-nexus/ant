/**
 * GitSyncedMenu — secondary Push / Pull / Fetch buttons shown once the
 * repo + upstream are both configured.
 *
 * Disabled states come from the `GitMenu` selector (`pullBlockedByChanges`,
 * `canPush`, `canPull`, `canFetch`) — never computed in this component.
 */

import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { useGitMenu, useGitDispatch, useGitOperation } from '../../domain/git-world';

export interface GitSyncedMenuProps {
  feature?: string;
  /** Declared GitHub repo URL from projectConfig. */
  githubRepo: string | null;
}

export function GitSyncedMenu({ feature, githubRepo }: GitSyncedMenuProps) {
  const menu = useGitMenu(githubRepo);
  const op = useGitOperation();
  const { runGitOperation, selectedProject } = useGitDispatch();

  if (menu.kind !== 'synced') return null;

  const isRunning = op.status === 'running';
  const btn =
    'inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        disabled={!menu.canPush || isRunning}
        className={btn}
        onClick={() => {
          if (selectedProject) void runGitOperation(selectedProject, { kind: 'push', feature });
        }}
      >
        <ArrowUp className="h-3 w-3" /> Push
      </button>
      <button
        disabled={!menu.canPull || isRunning}
        className={btn}
        title={menu.pullBlockedByChanges ? 'Commit or discard local changes first' : undefined}
        onClick={() => {
          if (selectedProject) void runGitOperation(selectedProject, { kind: 'pull', feature });
        }}
      >
        <ArrowDown className="h-3 w-3" /> Pull
      </button>
      <button
        disabled={!menu.canFetch || isRunning}
        className={btn}
        onClick={() => {
          if (selectedProject) void runGitOperation(selectedProject, { kind: 'fetch', feature });
        }}
      >
        <RefreshCw className="h-3 w-3" /> Fetch
      </button>
    </div>
  );
}
