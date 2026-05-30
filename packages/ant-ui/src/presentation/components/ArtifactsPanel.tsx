
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Upload, X, Check, AlertCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import {
  createFile,
  uploadFiles,
  createDirectory,
  deleteFileOrDirectory,
  renameFileOrDirectory,
  getDownloadUrl,
  fetchTransferRequests,
} from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { cn } from '@/shared/utils/design-system';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { ApiError } from '@/infrastructure/http/api/client';
import {
  UploadConflictModal,
  type ConflictResolution,
} from '@/presentation/components/common/UploadConflictModal';
import {
  findConflicts,
  getAllExistingNames,
  applyPerFileResolutions,
  fileListToEntries,
} from '@/shared/utils/upload-utils';
import {
  UI_PANEL_TOP_LEVEL_DIRS,
  pruneFileTreeForWorkspaceDomain,
  type ArtifactPermissions,
} from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { ArtifactsSection } from './ArtifactsPanel/ArtifactsSection';
import { TransferToolbar } from './ArtifactsPanel/TransferToolbar';
import { FigmaStatusIndicator, TemplateStatusIndicator } from './ArtifactsPanel/Indicators';

/**
 * Panel-level artifacts host.
 *
 * Aligned with the Explorer ProjectSection/FeatureSection pattern: this
 * panel renders no SectionShell of its own. Each visible top-level
 * domain is one <ArtifactsSection> (= one SectionShell), siblings in
 * a simple vertical stack, mirroring how ProjectSection /
 * FeatureSection live as siblings under ExplorerPanel. The transfer
 * affordance lives in a sibling <TransferToolbar /> at the top of the
 * panel — analogous to <GitToolbar /> under the active project row.
 *
 * Panel-scoped concerns kept here:
 *   • file-tree refresh / pruning lifecycle
 *   • mutation handlers (create/rename/delete/upload/send/download)
 *   • upload conflict modal + progress portal
 *   • drop error toast portal
 *   • transfer state polling
 */
export function ArtifactsPanel({ explorerWidth }: { explorerWidth: number }) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const selectFile = useStore((state) => state.selectFile);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const isSessionRestoring = useStore((state) => state.isSessionRestoring);
  const openTransferTab = useStore((state) => state.openTransferTab);
  const pendingTransferCount = useStore((state) => state.pendingTransferCount);
  const setPendingTransferCount = useStore((state) => state.setPendingTransferCount);
  const unseenArtifacts = useStore((state) => state.unseenArtifacts) as string[];
  const markArtifactsSeen = useStore((state) => state.markArtifactsSeen);
  const bridgeConnected = useStore((state) => state.bridgeConnected);
  const figmaDesktopReachable = useStore((state) => state.figmaDesktopReachable);
  const setAccountConfigScrollTarget = useStore((state) => state.setAccountConfigScrollTarget);

  const notifyArtifactMutationBlocked = useNotifyArtifactMutationBlocked();
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('artifacts');

  // Hide button labels when explorer is narrow
  const isNarrow = explorerWidth < 260;

  // Drop error notification (shown in the same bottom-center area as upload progress)
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDropError = useCallback((message: string) => {
    if (dropErrorTimerRef.current) clearTimeout(dropErrorTimerRef.current);
    setDropError(message);
    dropErrorTimerRef.current = setTimeout(() => setDropError(null), 3000);
  }, []);

  // Figma config state — from Zustand store
  const figmaPopulated = useStore((state) => state.figmaPopulated);
  const refreshFigmaPopulated = useStore((state) => state.refreshFigmaPopulated);
  const workspaceDomain = useStore((state) => state.actionMetadata?.domain);

  useEffect(() => {
    refreshFigmaPopulated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedFeature]);

  // Refresh file tree after session restore completes.
  useEffect(() => {
    if (!selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    if (isSessionRestoring) return;

    refreshFileTree();
  }, [selectedProject, selectedFeature, isSessionRestoring, refreshFileTree, connectionStatus]);

  // Fetch pending transfer count when connection is ready and session restore is complete
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    if (!selectedProject || !selectedFeature) return;
    if (isSessionRestoring) return;
    fetchTransferRequests('received')
      .then(({ pendingCount }) => setPendingTransferCount(pendingCount))
      .catch(() => {});
  }, [
    connectionStatus,
    selectedProject,
    selectedFeature,
    isSessionRestoring,
    setPendingTransferCount,
  ]);

  const format422Error = (error: ApiError, dirPath: string): string => {
    if (error.code === 'INVALID_EXTENSION' && error.allowed)
      return t('error.invalidExtension', { dir: dirPath, allowed: error.allowed.join(', ') });
    if (error.code === 'SUBDIRS_NOT_ALLOWED')
      return t('error.subdirsNotAllowed', { dir: dirPath });
    return error.message;
  };

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, dirPath), { title: t('common:error.title') });
      } else {
        console.error('Failed to create file:', error);
        showError(t('error.fileCreateFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleCreateDirectory = async (dirPath: string, dirName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    try {
      const fullPath = `${dirPath}/${dirName}`;
      await createDirectory(selectedProject, selectedFeature, fullPath);
      await refreshFileTree();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, dirPath), { title: t('common:error.title') });
      } else {
        console.error('Failed to create directory:', error);
        showError(t('error.dirCreateFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleDelete = async (itemPath: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    try {
      await deleteFileOrDirectory(selectedProject, selectedFeature, itemPath);

      const staleUnseen = unseenArtifacts.filter(
        (p) => p === itemPath || p.startsWith(itemPath + '/'),
      );
      if (staleUnseen.length > 0) {
        markArtifactsSeen(staleUnseen);
      }

      await refreshFileTree({ force: false });
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError(t('error.deleteFailed'), { title: t('common:error.title') });
    }
  };

  const handleRename = async (oldPath: string, newName: string) => {
    if (notifyArtifactMutationBlocked()) return;
    if (!selectedProject || !selectedFeature) return;

    const parentDir = oldPath.includes('/')
      ? oldPath.substring(0, oldPath.lastIndexOf('/'))
      : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    if (oldPath === newPath) return;

    try {
      await renameFileOrDirectory(selectedProject, selectedFeature, oldPath, newPath);
      await refreshFileTree();
      if (selectedFile === oldPath) {
        selectFile(newPath);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        showError(format422Error(error, parentDir), { title: t('common:error.title') });
      } else {
        console.error('Failed to rename:', error);
        showError(t('error.renameFailed'), { title: t('common:error.title') });
      }
    }
  };

  const handleFileSelect = (path: string) => {
    // ArtifactsSection uses '' to mean deselect
    selectFile(path);
    if (path && path.length > 0) {
      openMainPanelTab('fileEdit');
      if (unseenArtifacts?.includes(path)) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('[trace] markArtifactsSeen', path, Math.round(performance.now()));
        }
        markArtifactsSeen([path]);
      }
    }
  };

  const handleSend = (path: string, type: 'file' | 'directory') => {
    if (!selectedProject || !selectedFeature) return;
    openTransferTab({
      subTab: 'send',
      preselectedSource: {
        projectId: selectedProject,
        featureId: selectedFeature,
        path,
        type,
      },
    });
  };

  const handleDownload = (path: string) => {
    if (!selectedProject || !selectedFeature) return;
    const url = getDownloadUrl(selectedProject, selectedFeature, path);
    window.open(url, '_blank');
  };

  // ── Upload state (progress + cancel) ─────────────────────────────
  const [uploadState, setUploadState] = useState<{
    loaded: number;
    total: number;
    fileCount: number;
    targetDir: string;
    completed?: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Upload conflict modal state ──────────────────────────────────
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    conflictingFiles: string[];
    dirPath: string;
    entries: UploadFileEntry[];
  }>({ isOpen: false, conflictingFiles: [], dirPath: '', entries: [] });

  const dismissUpload = useCallback(() => {
    if (lingerTimerRef.current) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
    setUploadState(null);
  }, []);

  const doUpload = useCallback(
    async (dirPath: string, files: UploadFileEntry[]) => {
      if (notifyArtifactMutationBlocked()) return;
      if (!selectedProject || !selectedFeature) return;

      const count = files.length;
      const controller = new AbortController();
      abortRef.current = controller;
      dismissUpload();
      setUploadState({ loaded: 0, total: 0, fileCount: count, targetDir: dirPath });

      try {
        await uploadFiles(selectedProject, selectedFeature, dirPath, files, {
          onProgress: (loaded, total) =>
            setUploadState((prev) => (prev ? { ...prev, loaded, total } : prev)),
          signal: controller.signal,
        });
        await refreshFileTree();
        setUploadState((prev) => (prev ? { ...prev, loaded: prev.total, completed: true } : prev));
        lingerTimerRef.current = setTimeout(dismissUpload, 3000);
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') {
          console.log('[Upload] Cancelled by user');
        } else if (error instanceof ApiError && error.status === 422) {
          showError(format422Error(error, dirPath), { title: t('common:error.title') });
        } else {
          console.error('Failed to upload files:', error);
          showError(t('error.uploadFailed'), { title: t('common:error.title') });
        }
        setUploadState(null);
      } finally {
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedProject,
      selectedFeature,
      refreshFileTree,
      showError,
      t,
      dismissUpload,
      notifyArtifactMutationBlocked,
    ],
  );

  const checkConflictsAndUpload = useCallback(
    (dirPath: string, entries: UploadFileEntry[]) => {
      if (notifyArtifactMutationBlocked()) return;
      if (!fileTree) {
        doUpload(dirPath, entries);
        return;
      }
      const conflicts = findConflicts(fileTree, dirPath, entries);
      if (conflicts.length === 0) {
        doUpload(dirPath, entries);
        return;
      }
      setConflictModal({ isOpen: true, conflictingFiles: conflicts, dirPath, entries });
    },
    [fileTree, doUpload, notifyArtifactMutationBlocked],
  );

  const handleConflictResolve = useCallback(
    (resolution: ConflictResolution) => {
      const { dirPath, entries } = conflictModal;
      setConflictModal((prev) => ({ ...prev, isOpen: false }));

      if (resolution === 'cancel') return;

      const existingNames = fileTree ? getAllExistingNames(fileTree, dirPath) : [];
      const finalEntries = applyPerFileResolutions(entries, resolution.perFile, existingNames);
      doUpload(dirPath, finalEntries);
    },
    [conflictModal, doUpload, fileTree],
  );

  const handleUploadFiles = useCallback(
    (dirPath: string, files: FileList) => {
      checkConflictsAndUpload(dirPath, fileListToEntries(files));
    },
    [checkConflictsAndUpload],
  );

  const handleDropFiles = useCallback(
    (dirPath: string, entries: UploadFileEntry[]) => {
      checkConflictsAndUpload(dirPath, entries);
    },
    [checkConflictsAndUpload],
  );

  const handleCancelUpload = useCallback(() => {
    if (uploadState?.completed) {
      dismissUpload();
    } else {
      abortRef.current?.abort();
    }
  }, [uploadState?.completed, dismissUpload]);

  const prunedFileTree = useMemo(
    () => (fileTree?.length ? pruneFileTreeForWorkspaceDomain(fileTree, workspaceDomain) : fileTree),
    [fileTree, workspaceDomain],
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Unified Artifacts tree — a single <ArtifactsSection> wraps the
  // canonical 'Artifacts' SectionShell header (handoff B3). The
  // domain roots (plan/architecture/visual/assets/meta/sessions) are
  // rendered as folder rows inside that single section.
  //
  // Derived values below are memoized so the <ArtifactsSection nodes={...}>
  // prop keeps a stable reference across parent re-renders. Child effects
  // that depend on `nodes` would otherwise re-run on every keystroke /
  // file-select / store update and reset internal UI state.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const topLevelByName = useMemo(
    () => new Map(prunedFileTree?.map((n) => [n.name, n]) ?? []),
    [prunedFileTree],
  );

  const planTemplateFiles = useMemo(
    () =>
      topLevelByName.get('plan')?.children?.filter((n) => n.type === 'file' && n.meta?.isTemplate) ||
      [],
    [topLevelByName],
  );

  // Build domain-root nodes for the unified tree. Each entry in the
  // canonical UI_PANEL_TOP_LEVEL_DIRS becomes one top-level folder row.
  // Missing domains (filetree hasn't materialized them yet) are
  // rendered as synthetic empty-directory placeholders so the row is
  // visible regardless — matches the handoff b3-explorer FileTree UX.
  const visibleTopLevelDirNodes = useMemo<FileNode[]>(
    () =>
      UI_PANEL_TOP_LEVEL_DIRS.map(({ name }) => {
        const existing = topLevelByName.get(name);
        if (existing) return existing;
        return {
          name,
          path: name,
          type: 'directory',
          children: [],
        } as FileNode;
      }),
    [topLevelByName],
  );

  // Per-row permission resolver — maps a node path to its owning
  // domain's ArtifactPermissions via the path's top-level segment.
  const permissionsByDomain = useMemo(
    () =>
      new Map<string, ArtifactPermissions | undefined>(
        UI_PANEL_TOP_LEVEL_DIRS.map((d) => [d.name, d.permissions]),
      ),
    [],
  );
  const getNodePermissions = useCallback(
    (path: string): ArtifactPermissions | undefined => {
      const top = path.split('/')[0];
      return permissionsByDomain.get(top);
    },
    [permissionsByDomain],
  );

  // Merge indicator dictionaries across all domains. Keys are file
  // basenames as before — ArtifactsSection reads `fileIndicators[node.name]`
  // for file rows so the key namespace is unchanged.
  const mergedIndicators = useMemo<Record<string, React.ReactNode>>(
    () => ({
      ...Object.fromEntries(
        planTemplateFiles.map((n) => [
          n.name,
          <TemplateStatusIndicator
            key={`tpl-${n.name}`}
            reason={n.meta?.templateReason ?? undefined}
            contentLength={n.meta?.templateContentLength}
            threshold={n.meta?.templateThreshold}
            t={t}
          />,
        ]),
      ),
      'figma.json': (
        <FigmaStatusIndicator
          isPopulated={figmaPopulated}
          bridgeConnected={bridgeConnected === true}
          figmaDesktopReachable={figmaDesktopReachable}
          onOpenSettings={() => {
            openMainPanelTab('accountConfig');
            setAccountConfigScrollTarget('figma');
          }}
          t={t}
        />
      ),
    }),
    [
      planTemplateFiles,
      figmaPopulated,
      bridgeConnected,
      figmaDesktopReachable,
      t,
      openMainPanelTab,
      setAccountConfigScrollTarget,
    ],
  );

  // Don't show if no feature is selected (must be after all hooks)
  if (!selectedProject || !selectedFeature) {
    return null;
  }

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.preventDefault()}>
      <div className="space-y-1">
        <ArtifactsSection
          title={t('panel.title', 'Artifacts')}
          accent="orange"
          headerAction={
            <TransferToolbar
              isNarrow={isNarrow}
              onOpenTransfer={(subTab) => openTransferTab({ subTab })}
              pendingTransferCount={pendingTransferCount}
              t={t}
            />
          }
          nodes={visibleTopLevelDirNodes}
          sectionPrefix={undefined}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={handleCreateFile}
          onCreateDirectory={handleCreateDirectory}
          onUploadFiles={handleUploadFiles}
          onDropFiles={handleDropFiles}
          onRename={handleRename}
          onDelete={handleDelete}
          onSend={handleSend}
          onDownload={handleDownload}
          onDropError={showDropError}
          unseenArtifacts={unseenArtifacts}
          onMarkSeen={markArtifactsSeen}
          notifyArtifactMutationBlocked={notifyArtifactMutationBlocked}
          fileIndicators={mergedIndicators}
          getNodePermissions={getNodePermissions}
        />
      </div>

      {/* Upload conflict modal */}
      <UploadConflictModal
        isOpen={conflictModal.isOpen}
        onClose={() => setConflictModal((prev) => ({ ...prev, isOpen: false }))}
        conflictingFiles={conflictModal.conflictingFiles}
        onResolve={handleConflictResolve}
      />

      {/* Bottom-center portal: upload progress OR drop error */}
      {(uploadState || dropError) &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 flex flex-col gap-2">
            {uploadState && (
              <div
                className={cn(
                  'rounded-xl border shadow-lg p-3 space-y-2 cursor-pointer transition-colors',
                  uploadState.completed
                    ? 'border-[color:var(--status-done-fg)] bg-[color:var(--bg-surface)]'
                    : 'border-[color:var(--violet-500)] bg-[color:var(--bg-surface)]',
                )}
                onClick={uploadState.completed ? dismissUpload : undefined}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'flex items-center gap-2 text-xs font-medium truncate',
                      uploadState.completed
                        ? 'text-[color:var(--status-done-fg)]'
                        : 'text-[color:var(--violet-700)]',
                    )}
                  >
                    {uploadState.completed ? (
                      <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    {uploadState.completed
                      ? t('upload.complete', { count: uploadState.fileCount })
                      : t('upload.uploading', {
                          count: uploadState.fileCount,
                          dir: uploadState.targetDir,
                        })}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelUpload();
                    }}
                    className="flex-shrink-0 ml-2 p-1 rounded-md hover:bg-[color:var(--bg-active)] text-[color:var(--text-4)] hover:text-[color:var(--text-3)] transition-colors"
                    title={uploadState.completed ? t('upload.dismiss') : t('upload.cancel')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div
                  className="w-full h-2 rounded-full overflow-hidden"
                  style={{
                    background: uploadState.completed
                      ? 'oklch(from var(--status-done-fg) l c h / 0.15)'
                      : 'var(--violet-100)',
                  }}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-200"
                    style={{
                      width:
                        uploadState.total > 0
                          ? `${Math.round((uploadState.loaded / uploadState.total) * 100)}%`
                          : '0%',
                      background: uploadState.completed
                        ? 'var(--status-done-fg)'
                        : 'var(--violet-500)',
                    }}
                  />
                </div>
                {uploadState.total > 0 && !uploadState.completed && (
                  <div className="text-[10px] text-[color:var(--violet-500)] text-right font-medium">
                    {Math.round((uploadState.loaded / uploadState.total) * 100)}%
                  </div>
                )}
              </div>
            )}
            {dropError && (
              <div
                className="relative rounded-xl border bg-[color:var(--bg-surface)] shadow-lg p-3 cursor-pointer transition-colors overflow-hidden"
                style={{ borderColor: 'var(--status-error-fg)' }}
                onClick={() => setDropError(null)}
              >
                <span className="flex items-center gap-2 text-xs font-medium text-[color:var(--status-error-fg)]">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {dropError}
                </span>
                <div
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'oklch(from var(--status-error-fg) l c h / 0.15)' }}
                >
                  <div
                    className="h-full"
                    style={{
                      background: 'var(--status-error-fg)',
                      animation: 'shrink-progress 3000ms linear forwards',
                    }}
                  />
                </div>
                <style>{`@keyframes shrink-progress{from{width:100%}to{width:0%}}`}</style>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
