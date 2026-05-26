import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useGitSnapshot,
  useGitOperation,
  useGitSnapshotRefreshing,
} from '@/domain/git-world';
import { useGitActions as useGitStoreActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';
import { GitChangesPanel } from './components/GitChangesPanel';
import { useStore } from '@/domain/store';
import type { ReactNode } from 'react';

interface GitStatusButtonProps {
  /**
   * Optional trailing slot rendered as the last item of the top action
   * row (ActionButton + discard + menuSlot). GitToolbar injects
   * `<GitMenuButton />` here so that branch row / changes panel below
   * inherit the full toolbar width (B3 handoff parity).
   */
  menuSlot?: ReactNode;
}

/**
 * Emerald action button + expandable changes panel. The sole consumer is
 * `ProjectSection`; internals talk only to the `git-world` public API.
 *
 * Loading/placeholder flow:
 *   - `operation.status === 'running'` → `<LoadingButton />` (phase label)
 *   - snapshot loaded but `!hasGit`   → `<PlaceholderButton />`
 *   - snapshot unloaded + refreshing  → `<LoadingButton />`
 *   - otherwise                       → `<ActionButton />` + changes panel
 *
 * Selected-file preservation mirrors the pre-greenfield UX: user picks
 * are kept across snapshot refreshes as long as the path still exists.
 */
export function GitStatusButton({ menuSlot }: GitStatusButtonProps = {}) {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const snapshot = useGitSnapshot();
  const snapshotRefreshing = useGitSnapshotRefreshing();
  const op = useGitOperation();

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const prevPathsRef = useRef<string>('');

  useEffect(() => {
    if (snapshot) {
      const allPaths = [
        ...snapshot.staged.map((f) => f.path),
        ...snapshot.unstaged.map((f) => f.path),
        ...snapshot.untracked.map((f) => f.path),
      ];
      const pathsKey = allPaths.slice().sort().join('\n');
      if (prevPathsRef.current !== pathsKey) {
        const prevPaths = new Set(prevPathsRef.current.split('\n').filter(Boolean));
        if (prevPaths.size === 0) {
          setSelectedFiles(allPaths);
        } else {
          const newPaths = allPaths.filter((p) => !prevPaths.has(p));
          setSelectedFiles((prev) => [
            ...prev.filter((p) => allPaths.includes(p)),
            ...newPaths,
          ]);
        }
        prevPathsRef.current = pathsKey;
      }
    } else {
      setSelectedFiles([]);
      prevPathsRef.current = '';
    }
  }, [snapshot]);

  const {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    isDiscarding,
    handleCommit,
    handlePush,
    handlePublishRepo,
    handlePull,
    handleSync,
    handleDiscard,
  } = useGitStoreActions(selectedProject, selectedFeature, snapshot);

  if (!selectedProject) {
    return null;
  }

  if (op.status === 'running') {
    return (
      <div className="w-full flex gap-1.5 items-center">
        <LoadingButton />
        {menuSlot}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="w-full flex gap-1.5 items-center">
        {snapshotRefreshing
          ? <LoadingButton />
          : <PlaceholderButton message={t('common:status.checking')} />}
        {menuSlot}
      </div>
    );
  }

  if (!snapshot.hasGit) {
    return (
      <div className="w-full flex gap-1.5 items-center">
        <PlaceholderButton message={t('config:git.notInitialized')} />
        {menuSlot}
      </div>
    );
  }

  const totalChanges = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length;
  const branch = snapshot.currentBranch ?? null;
  const ahead = snapshot.ahead ?? 0;
  const behind = snapshot.behind ?? 0;
  const showBranchRow = branch != null || totalChanges > 0;
  const toggleLabel = changesExpanded ? t('git.collapseChanges') : t('git.expandChanges');

  return (
    <>
      <div className="w-full flex gap-1.5 items-center">
        <ActionButton
          isCommitting={isCommitting}
          isPushing={isPushing}
          isPulling={isPulling}
          isSyncing={isSyncing}
          onCommit={handleCommit}
          onPush={handlePush}
          onPublishRepo={handlePublishRepo}
          onPull={handlePull}
          onSync={handleSync}
          selectedFiles={selectedFiles}
        />
        <button
          type="button"
          onClick={() => handleDiscard(selectedFiles.length < totalChanges ? selectedFiles : undefined)}
          disabled={totalChanges === 0 || isDiscarding}
          title={t('git.discardAll')}
          style={{
            width: 26,
            height: 26,
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--r-sm)',
            flexShrink: 0,
            cursor: totalChanges === 0 || isDiscarding ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            background: 'color-mix(in srgb, var(--red-500) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--red-500) 28%, transparent)',
            color: 'var(--red-500)',
            opacity: totalChanges === 0 || isDiscarding ? 0.5 : 1,
            transition: 'background var(--dur-fast) var(--ease-smooth)',
          }}
        >
          <Undo2 width={13} height={13} />
        </button>
        {menuSlot}
      </div>
      {showBranchRow && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingLeft: 2,
            minWidth: 0,
            width: '100%',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
            }}
          >
            {branch && (
              <>
                <GitBranch size={10} style={{ color: 'var(--violet-500)', flexShrink: 0 }} />
                <span
                  style={{
                    fontWeight: 600,
                    color: 'var(--text-1)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={branch}
                >
                  {branch}
                </span>
                {ahead > 0 && (
                  <span style={{ color: 'var(--violet-600)', fontWeight: 700, flexShrink: 0 }}>
                    ↑{ahead}
                  </span>
                )}
                {behind > 0 && (
                  <span style={{ color: 'var(--orange-600)', fontWeight: 700, flexShrink: 0 }}>
                    ↓{behind}
                  </span>
                )}
              </>
            )}
          </div>
          {totalChanges > 0 && (
            <button
              type="button"
              onClick={() => setChangesExpanded((v) => !v)}
              title={toggleLabel}
              aria-label={toggleLabel}
              aria-expanded={changesExpanded}
              style={{
                width: 26,
                height: 26,
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: 'var(--surface-2)',
                border: '1px solid var(--border-1)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--text-1)',
                transition: 'background var(--dur-fast) var(--ease-smooth)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'color-mix(in srgb, var(--violet-500) 8%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--surface-2)';
              }}
            >
              {changesExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          )}
        </div>
      )}
      {totalChanges > 0 && changesExpanded && (
        <div className="w-full">
          <GitChangesPanel
            staged={snapshot.staged}
            unstaged={snapshot.unstaged}
            untracked={snapshot.untracked}
            selectedFiles={selectedFiles}
            onSelectedFilesChange={setSelectedFiles}
          />
        </div>
      )}
    </>
  );
}
