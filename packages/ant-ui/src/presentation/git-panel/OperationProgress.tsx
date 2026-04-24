/**
 * OperationProgress — inline banner reflecting the current
 * {@link GitOperationState} FSM.
 *
 * Responsibility split:
 *  - `running` → informational spinner banner (with elapsed for >10s).
 *  - `failed`  → error banner with `suggestedAction`-driven recovery CTAs.
 *  - `idle`/`succeeded` → renders nothing (fire-and-forget completion).
 *
 * `suggestedAction` maps to 4 mutually-exclusive recovery paths enumerated
 * in `@ant/shared` (`GitSuggestedAction`):
 *   configurePat     → opens Account config (PAT tab)
 *   resolveConflict  → opens Code IDE
 *   reconfigureRepo  → opens Project config
 *   runClone         → re-dispatches as a Clone op
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, X } from 'lucide-react';
import { useGitOperation, useGitDispatch } from '../../domain/git-world';
import type {
  GitSuggestedAction,
  GitUserOperation,
} from '@ant/shared';

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

const OP_LABELS: Record<GitUserOperation['kind'], string> = {
  publish: 'Publishing to GitHub',
  push: 'Pushing to GitHub',
  pull: 'Pulling from GitHub',
  fetch: 'Fetching from GitHub',
  sync: 'Syncing with GitHub',
  commit: 'Committing changes',
  discard: 'Discarding changes',
  clone: 'Cloning from GitHub',
};

const ACTION_LABELS: Record<GitSuggestedAction, string> = {
  configurePat: 'Configure GitHub PAT',
  resolveConflict: 'Resolve in IDE',
  reconfigureRepo: 'Configure repository',
  runClone: 'Clone repository',
};

export interface OperationProgressProps {
  /** Hooks to open configuration/IDE surfaces; optional — if omitted, only
   *  Retry and Dismiss are shown. */
  onOpenPatConfig?: () => void;
  onOpenIDE?: () => void;
  onOpenProjectConfig?: () => void;
}

export function OperationProgress({
  onOpenPatConfig,
  onOpenIDE,
  onOpenProjectConfig,
}: OperationProgressProps = {}) {
  const op = useGitOperation();
  const { runGitOperation, clearGitOperation, selectedProject } = useGitDispatch();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (op.status !== 'running') return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [op.status]);

  if (op.status === 'idle' || op.status === 'succeeded') {
    return null;
  }

  if (op.status === 'running') {
    const elapsed = now - op.startedAt;
    const label = OP_LABELS[op.op.kind] ?? op.op.kind;
    return (
      <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}…</span>
        {elapsed > 10_000 && (
          <span className="ml-auto text-xs text-blue-700 dark:text-blue-300">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>
    );
  }

  // op.status === 'failed'
  const suggested = op.error.suggestedAction ?? null;
  const label = OP_LABELS[op.op.kind] ?? op.op.kind;

  const handleSuggestedAction = () => {
    switch (suggested) {
      case 'configurePat':
        onOpenPatConfig?.();
        break;
      case 'resolveConflict':
        onOpenIDE?.();
        break;
      case 'reconfigureRepo':
        onOpenProjectConfig?.();
        break;
      case 'runClone':
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'clone' });
        }
        break;
    }
  };

  const handleRetry = () => {
    if (selectedProject && op.status === 'failed') {
      void runGitOperation(selectedProject, op.op);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium">{label} failed</div>
          <div className="text-xs text-red-700 dark:text-red-300">{op.error.message}</div>
        </div>
        <button
          onClick={clearGitOperation}
          className="flex-shrink-0 rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/40"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        {suggested && ACTION_LABELS[suggested] && (
          <button
            onClick={handleSuggestedAction}
            className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-900 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900/40"
          >
            {ACTION_LABELS[suggested]}
          </button>
        )}
        {op.error.retryable && (
          <button
            onClick={handleRetry}
            className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-900 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
