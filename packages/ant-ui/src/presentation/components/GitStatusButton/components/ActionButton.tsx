
import { useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Download, RefreshCw, Check, Globe, CheckCircle2 } from 'lucide-react';
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

const CONTAINER_STYLE: CSSProperties = {
  containerType: 'inline-size',
  containerName: 'action-btn',
};

// Filled aurora-emerald gradient CTA per handoff b3-explorer.jsx GitStatusButton.
const FILLED_BUTTON_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 26,
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: 'linear-gradient(135deg, var(--emerald-500), oklch(64% 0.18 155))',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--r-sm)',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: 'var(--shadow-xs)',
  transition: 'transform var(--dur-fast) var(--ease-spring)',
  overflow: 'hidden',
};

// Neutral fallback for loading/noChanges (matches handoff disabled look).
const NEUTRAL_BUTTON_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 26,
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: 'var(--surface-2)',
  color: 'var(--text-3)',
  border: '1px solid var(--border-1)',
  borderRadius: 'var(--r-sm)',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'not-allowed',
  opacity: 0.6,
};

// White/25 inline count pill on the gradient background.
const COUNT_BADGE_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.25)',
  padding: '1px 6px',
  borderRadius: 999,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
};

interface FilledCtaProps {
  onClick: () => void;
  disabled: boolean;
  title?: string;
  children: React.ReactNode;
}

function FilledCta({ onClick, disabled, title, children }: FilledCtaProps) {
  const [hovered, setHovered] = useState(false);
  const handleEnter = (_e: MouseEvent<HTMLButtonElement>) => {
    if (!disabled) setHovered(true);
  };
  const handleLeave = (_e: MouseEvent<HTMLButtonElement>) => setHovered(false);

  const style: CSSProperties = {
    ...FILLED_BUTTON_STYLE,
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
    </button>
  );
}

/**
 * Primary Git CTA. All branching lives in `useGitCta` (pure selector over
 * the git-world `GitSnapshot`) so this component is a pure render of a
 * single discriminated-union result. ProjectSection's dropdown uses the
 * sister selector `useGitMenu` off the same snapshot — the two UIs agree
 * by construction.
 *
 * Visuals follow handoff/b3-explorer.jsx: filled aurora-emerald gradient
 * with white/25 count pills and 26px height, hover translateY(-1px).
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

  if (cta.kind === 'commit') {
    const commitCount = selectedFiles ? selectedFiles.length : cta.count;
    const disabled =
      isCommitting ||
      isFetchBlockingCta ||
      (selectedFiles !== undefined && selectedFiles.length === 0);
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <FilledCta
          onClick={() => onCommit(selectedFiles)}
          disabled={disabled}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          {isCommitting ? (
            <>
              <Spinner size="sm" tone="inherit" />
              <span className="action-label truncate">{t('git.committing')}</span>
            </>
          ) : (
            <>
              <CheckCircle2 width={11} height={11} style={{ flexShrink: 0 }} />
              <span className="action-label truncate" style={{ flex: 1, textAlign: 'left' }}>
                {t('git.commitAction')}
              </span>
              {commitCount > 0 && <span style={COUNT_BADGE_STYLE}>{commitCount}</span>}
            </>
          )}
        </FilledCta>
      </div>
    );
  }

  if (cta.kind === 'publish') {
    const handler = cta.variant === 'noRemoteWithFeatures' ? onPublishRepo : onPush;
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <FilledCta
          onClick={handler}
          disabled={isPushing || isFetchBlockingCta}
          title={
            cta.variant === 'noRemoteWithFeatures'
              ? t('config:git.publishToGitHubDesc')
              : t('git.publishNewBranchDesc')
          }
        >
          {isPushing ? (
            <>
              <Spinner size="sm" tone="inherit" />
              <span className="action-label truncate">{t('git.publishing')}</span>
            </>
          ) : (
            <>
              <Globe width={11} height={11} style={{ flexShrink: 0 }} />
              <span className="action-label truncate" style={{ flex: 1, textAlign: 'left' }}>
                {cta.variant === 'noRemoteWithFeatures'
                  ? t('config:git.publish')
                  : t('git.publishNewBranch')}
              </span>
            </>
          )}
        </FilledCta>
      </div>
    );
  }

  if (cta.kind === 'sync') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <FilledCta
          onClick={onSync}
          disabled={isSyncing || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : t('git.pullThenPush')}
        >
          {isSyncing ? (
            <>
              <Spinner size="sm" tone="inherit" />
              <span className="action-label truncate">{t('git.syncingFromRemote')}</span>
            </>
          ) : (
            <>
              <RefreshCw width={11} height={11} style={{ flexShrink: 0 }} />
              <span className="action-label truncate" style={{ flex: 1, textAlign: 'left' }}>
                {t('git.sync')}
              </span>
              <span style={COUNT_BADGE_STYLE}>
                <Upload width={11} height={11} />
                {cta.ahead}
              </span>
              <span style={COUNT_BADGE_STYLE}>
                <Download width={11} height={11} />
                {cta.behind}
              </span>
            </>
          )}
        </FilledCta>
      </div>
    );
  }

  if (cta.kind === 'push') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <FilledCta
          onClick={onPush}
          disabled={isPushing || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          {isPushing ? (
            <>
              <Spinner size="sm" tone="inherit" />
              <span className="action-label truncate">{t('git.pushing')}</span>
            </>
          ) : (
            <>
              <Upload width={11} height={11} style={{ flexShrink: 0 }} />
              <span className="action-label truncate" style={{ flex: 1, textAlign: 'left' }}>
                {t('config:git.push')}
              </span>
              <span style={COUNT_BADGE_STYLE}>{cta.ahead}</span>
            </>
          )}
        </FilledCta>
      </div>
    );
  }

  if (cta.kind === 'pull') {
    return (
      <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
        <style>{CONTAINER_QUERY_STYLE}</style>
        <FilledCta
          onClick={onPull}
          disabled={isPulling || isFetchBlockingCta}
          title={isFetchBlockingCta ? t('git.updatingStatus') : undefined}
        >
          {isPulling ? (
            <>
              <Spinner size="sm" tone="inherit" />
              <span className="action-label truncate">{t('git.pulling')}</span>
            </>
          ) : (
            <>
              <Download width={11} height={11} style={{ flexShrink: 0 }} />
              <span className="action-label truncate" style={{ flex: 1, textAlign: 'left' }}>
                {t('config:git.pull')}
              </span>
              <span style={COUNT_BADGE_STYLE}>{cta.behind}</span>
            </>
          )}
        </FilledCta>
      </div>
    );
  }

  // `loading` / `noChanges` → neutral disabled look.
  return (
    <div className="flex items-center flex-1 min-w-0" style={CONTAINER_STYLE}>
      <style>{CONTAINER_QUERY_STYLE}</style>
      <button type="button" disabled style={NEUTRAL_BUTTON_STYLE}>
        <Check width={11} height={11} style={{ flexShrink: 0 }} />
        <span className="action-label truncate">{t('git.noChanges')}</span>
      </button>
    </div>
  );
}
