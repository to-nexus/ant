import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
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
import { Button } from '@/presentation/components/aurora';
import { useStore } from '@/domain/store';

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
export function GitStatusButton() {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const snapshot = useGitSnapshot();
  const snapshotRefreshing = useGitSnapshotRefreshing();
  const op = useGitOperation();

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
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
    return <LoadingButton />;
  }

  if (!snapshot) {
    return snapshotRefreshing
      ? <LoadingButton />
      : <PlaceholderButton message={t('common:status.checking')} />;
  }

  if (!snapshot.hasGit) {
    return <PlaceholderButton message={t('config:git.notInitialized')} />;
  }

  const totalChanges = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length;

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
        <Button
          onClick={() => handleDiscard(selectedFiles.length < totalChanges ? selectedFiles : undefined)}
          variant="outline"
          size="sm"
          className="flex items-center justify-center w-[26px] h-[26px] p-0 flex-shrink-0 transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--red-500) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--red-500) 28%, transparent)',
            color: 'var(--red-500)',
          }}
          disabled={totalChanges === 0 || isDiscarding}
          title={t('git.discardAll')}
        >
          <Undo2 className="w-3 h-3" />
        </Button>
      </div>
      {totalChanges > 0 && (
        <div className="w-full">
          <GitChangesPanel
            staged={snapshot.staged}
            unstaged={snapshot.unstaged}
            untracked={snapshot.untracked}
            selectedFiles={selectedFiles}
            onSelectedFilesChange={setSelectedFiles}
            onDiscardFiles={(files) => handleDiscard(files)}
            isDiscarding={isDiscarding}
          />
        </div>
      )}
    </>
  );
}
