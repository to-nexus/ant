import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/aurora';
import { Spinner } from '../../common/async';
import { useGitOperation, useGitSnapshotRefreshing } from '@/domain/git-world';
import type { GitUserOperationKind } from '@ant/shared';

/**
 * Phase-aware loading label. Derives the in-flight verb from the
 * `git-world` FSM (`useGitOperation`). Fallback is the generic
 * "checking" label shown while the first snapshot fetch is in flight.
 */
const OP_LABEL_KEY: Record<GitUserOperationKind, string> = {
  clone: 'git.cloning',
  publish: 'git.publishing',
  push: 'git.pushing',
  pull: 'git.pulling',
  fetch: 'git.fetching',
  sync: 'git.syncing',
  commit: 'git.committing',
  discard: 'git.discarding',
};

export function LoadingButton() {
  const { t } = useTranslation('explorer');
  const op = useGitOperation();
  const refreshing = useGitSnapshotRefreshing();

  let loadingMessage = t('git.updating');
  if (op.status === 'running') {
    loadingMessage = t(OP_LABEL_KEY[op.op.kind]);
  } else if (refreshing) {
    loadingMessage = t('git.checking');
  }

  return (
    <div className="flex items-center flex-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium opacity-50 cursor-default"
        style={{
          color: 'var(--text-3)',
          border: '1px solid var(--border-1)',
          background: 'var(--surface-2)',
        }}
      >
        <Spinner size="sm" tone="inherit" />
        {loadingMessage}
      </Button>
    </div>
  );
}
