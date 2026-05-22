import { useTranslation } from 'react-i18next';
import { GitCommit, Upload, Download, RefreshCw, Check, Globe } from 'lucide-react';
import { Button } from '@/presentation/components/aurora';
import { Spinner } from '../../common/async';
import {
  useGitCta,
  useGitSnapshotRefreshing,
} from '@/domain/git-world';

interface ActionButtonProps {
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isSyncing: boolean;
  onCommit: (files?: string[]) => void;
  onPush: () => void;
  /** Create a new remote repo and push. Triggered only for the
   *  `publish.variant === 'noRemoteWithFeatures'` CTA. */
  onPublishRepo: () => void;
  onPull: () => void;
  onSync: () => void;
  selectedFiles?: string[];
}

const CONTAINER_QUERY_STYLE = `
@container action-btn (max-width: 80px) {
  .action-label { display: none; }
}
`;

const CONTAINER_STYLE = { containerType: 'inline-size' as const, containerName: 'action-btn' };

/**
 * Primary Git CTA. All branching lives in `useGitCta` (pure selector over
 * the git-world `GitSnapshot`) so this component is a pure render of a
 * single discriminated-union result. ProjectSection's dropdown uses the
 * sister selector `useGitMenu` off the same snapshot — the two UIs agree
 * by construction.
 */
export function ActionButton({
  isCommitting,
  isPushing,
  isPulling,
  isSyncing,
  onCommit,
  onPush,
  onPublishRepo,
  onPull,
  onSync,
  selectedFiles,
}: ActionButtonProps) {
  const { t } = useTranslation('explorer');
  const cta = useGitCta();
  const isFetchBlockingCta = useGitSnapshotRefreshing();

  // Aurora "done" tone — semantic success color via design tokens.
  // (spec §1.1.6: emerald is the status=done semantic, but ONLY through tokens.)
  const actionButtonClass =
    'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium min-w-0 overflow-hidden transition-colors';
  const actionButtonStyle: React.CSSProperties = {
    background: 'var(--status-done-bg)',
    border: '1px solid color-mix(in srgb, var(--emerald-500) 30%, transparent)',
    color: 'var(--status-done-fg)',
  };

  if (cta.kind === 'commit') {
    const commitCount = selectedFiles ? selectedFiles.length : cta.count;
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <Button
          onClick={() => onCommit(selectedFiles)}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          style={actionButtonStyle}
          disabled={isCommitting || isFetchBlockingCta || (selectedFiles !== undefined && selectedFiles.length === 0)}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          <GitCommit className="w-3.5 h-3.5 flex-shrink-0" />
          {isCommitting ? (
            <span className="action-label truncate">{t('git.committing')}</span>
          ) : (
            <>
              <span className="action-label truncate">{t('git.commitAction')}</span>
              <span className="flex-shrink-0 tabular-nums">{commitCount}</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  if (cta.kind === 'publish') {
    // Dispatch split by selector-derived variant — no re-inspection of
    // snapshot.remoteUrl downstream:
    //   noRemoteWithFeatures → create GitHub repo then push (onPublishRepo)
    //   noUpstream           → plain push; BE auto-sets -u
    const handler = cta.variant === 'noRemoteWithFeatures' ? onPublishRepo : onPush;
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <Button
          onClick={handler}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          style={actionButtonStyle}
          disabled={isPushing || isFetchBlockingCta}
          title={cta.variant === 'noRemoteWithFeatures'
            ? t('config:git.publishToGitHubDesc')
            : t('git.publishNewBranchDesc')}
        >
          <Globe className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="action-label truncate">
            {isPushing
              ? t('git.publishing')
              : cta.variant === 'noRemoteWithFeatures'
                ? t('config:git.publish')
                : t('git.publishNewBranch')}
          </span>
        </Button>
      </div>
    );
  }

  if (cta.kind === 'sync') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <Button
          onClick={onSync}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          style={actionButtonStyle}
          disabled={isSyncing || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : t('git.pullThenPush')}
        >
          {isSyncing ? (
            <Spinner size="sm" tone="inherit" className="flex-shrink-0" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          {isSyncing ? (
            <span className="action-label truncate">{t('git.syncingFromRemote')}</span>
          ) : (
            <>
              <span className="action-label truncate">{t('git.sync')}</span>
              <span className="flex-shrink-0 flex items-center gap-1">
                <Upload className="w-3 h-3" />
                {cta.ahead}
              </span>
              <span className="flex-shrink-0 flex items-center gap-1">
                <Download className="w-3 h-3" />
                {cta.behind}
              </span>
            </>
          )}
        </Button>
      </div>
    );
  }

  if (cta.kind === 'push') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <Button
          onClick={onPush}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          style={actionButtonStyle}
          disabled={isPushing || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          <Upload className="w-3.5 h-3.5 flex-shrink-0" />
          {isPushing ? (
            <span className="action-label truncate">{t('git.pushing')}</span>
          ) : (
            <>
              <span className="action-label truncate">{t('config:git.push')}</span>
              <span className="flex-shrink-0 tabular-nums">{cta.ahead}</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  if (cta.kind === 'pull') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <Button
          onClick={onPull}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          style={actionButtonStyle}
          disabled={isPulling || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          <Download className="w-3.5 h-3.5 flex-shrink-0" />
          {isPulling ? (
            <span className="action-label truncate">{t('git.pulling')}</span>
          ) : (
            <>
              <span className="action-label truncate">{t('config:git.pull')}</span>
              <span className="flex-shrink-0 tabular-nums">{cta.behind}</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  // `loading` / `noChanges` falls through to the neutral look — the
  // parent GitStatusButton already renders a spinner when it matters.
  return (
    <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
      <style>{CONTAINER_QUERY_STYLE}</style>
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium min-w-0 overflow-hidden opacity-50 cursor-default"
        style={{
          color: 'var(--text-3)',
          border: '1px solid var(--border-1)',
          background: 'var(--surface-2)',
        }}
      >
        <Check className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="action-label truncate">{t('git.noChanges')}</span>
      </Button>
    </div>
  );
}
