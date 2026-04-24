/**
 * GitSetupMenu — the Clone / Publish offer presented when a project has
 * no `.git` directory yet.
 *
 * Behavior hinges on {@link useGitSetupCta}:
 *  - `clone`     → single-button [Clone from GitHub]
 *  - `publish`   → single-button [Publish to GitHub]
 *  - `ambiguous` → both buttons (probe failed / unknown)
 *
 * When the menu opens we optionally refresh state with `{ fresh: true }`
 * so the probe cache is bypassed.
 */

import { useEffect } from 'react';
import { GitBranch, Upload } from 'lucide-react';
import {
  useGitSetupCta,
  useGitDispatch,
  useGitOperation,
} from '../../domain/git-world';

export interface GitSetupMenuProps {
  feature?: string;
  /** Fire a fresh probe on mount. Set to false inside an always-open panel. */
  probeOnMount?: boolean;
}

export function GitSetupMenu({ feature, probeOnMount = true }: GitSetupMenuProps) {
  const cta = useGitSetupCta();
  const op = useGitOperation();
  const { runGitOperation, fetchGitWorldState, selectedProject } = useGitDispatch();

  useEffect(() => {
    if (probeOnMount && selectedProject) {
      void fetchGitWorldState(selectedProject, { feature, fresh: true });
    }
  }, [probeOnMount, selectedProject, feature, fetchGitWorldState]);

  const isRunning = op.status === 'running';

  const btn =
    'inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

  const showClone = cta.kind === 'clone' || cta.kind === 'ambiguous';
  const showPublish = cta.kind === 'publish' || cta.kind === 'ambiguous';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showClone && (
        <button
          disabled={isRunning || !selectedProject}
          className={btn}
          onClick={() => {
            if (selectedProject) void runGitOperation(selectedProject, { kind: 'clone' });
          }}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Clone from GitHub
        </button>
      )}
      {showPublish && (
        <button
          disabled={isRunning || !selectedProject}
          className={btn}
          onClick={() => {
            if (selectedProject) void runGitOperation(selectedProject, { kind: 'publish', feature });
          }}
        >
          <Upload className="h-3.5 w-3.5" />
          Publish to GitHub
        </button>
      )}
    </div>
  );
}
