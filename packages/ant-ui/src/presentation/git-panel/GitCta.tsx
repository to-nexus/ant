/**
 * GitCta — the primary action button rendered at the top of GitPanel.
 *
 * Binds {@link useGitCta} + {@link useGitDispatch} to a single <button>.
 * Every branch dispatches exactly one `GitUserOperation`; the button is
 * disabled while an operation is running (exclusive FSM).
 */

import { Spinner } from '@/presentation/components/common/async';
import { useGitCta, useGitDispatch, useGitOperation } from '../../domain/git-world';

export interface GitCtaProps {
  feature?: string;
  /** Disable the button externally (e.g. while the snapshot is loading). */
  disabled?: boolean;
}

export function GitCta({ feature, disabled }: GitCtaProps) {
  const cta = useGitCta();
  const op = useGitOperation();
  const { runGitOperation, selectedProject } = useGitDispatch();

  const isRunning = op.status === 'running';
  const isDisabled = Boolean(disabled || isRunning || !selectedProject);

  let label = '';
  let variant: 'primary' | 'secondary' = 'primary';
  let onClick: (() => void) | null = null;

  switch (cta.kind) {
    case 'loading':
      label = 'Loading…';
      variant = 'secondary';
      break;
    case 'noChanges':
      label = 'Up to date';
      variant = 'secondary';
      break;
    case 'commit':
      label = `Commit ${cta.count}`;
      onClick = () => {
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'commit', feature });
        }
      };
      break;
    case 'publish':
      label = cta.variant === 'noRemoteWithFeatures' ? 'Publish to GitHub' : 'Publish branch';
      onClick = () => {
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'publish', feature });
        }
      };
      break;
    case 'sync':
      label = `Sync (+${cta.ahead} / -${cta.behind})`;
      onClick = () => {
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'sync', feature });
        }
      };
      break;
    case 'push':
      label = `Push ${cta.ahead}`;
      onClick = () => {
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'push', feature });
        }
      };
      break;
    case 'pull':
      label = `Pull ${cta.behind}`;
      onClick = () => {
        if (selectedProject) {
          void runGitOperation(selectedProject, { kind: 'pull', feature });
        }
      };
      break;
  }

  const base = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
  const variantCls =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-500'
      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-100 disabled:text-gray-400 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

  return (
    <button
      onClick={onClick ?? undefined}
      disabled={isDisabled || !onClick}
      className={`${base} ${variantCls}`}
    >
      {isRunning && (
        <Spinner
          size="sm"
          tone={variant === 'primary' ? 'inverse' : 'muted'}
        />
      )}
      {label}
    </button>
  );
}
