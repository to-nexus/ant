
import { useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  createFile,
  uploadFiles,
  createDirectory,
  deleteFileOrDirectory,
  renameFileOrDirectory,
  getDownloadUrl,
  preflightDirectoryDownload,
  fetchTransferRequests,
} from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { useSendToTransfer } from '@/application/hooks/ui/useSendToTransfer';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { ApiError } from '@/infrastructure/http/api/client';
import { UploadConflictModal } from '@/presentation/components/common/UploadConflictModal';
import { UploadStatusCard } from '@/presentation/components/common/UploadStatusCard';
import { useUploadConflicts } from '@/application/hooks/ui/useUploadConflicts';
import { useUploadStatus } from '@/application/hooks/ui/useUploadStatus';
import {
  UI_PANEL_TOP_LEVEL_DIRS,
  UPLOAD_FILE_MAX_BYTES,
  pruneFileTreeForWorkspaceDomain,
  type ArtifactPermissions,
} from '@ant/shared';
import { PartialUploadError, uploadRefusalMessage } from '@/shared/utils/upload-utils';
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

  // Upload progress card + the short-lived refusal line share one owner.
  const upload = useUploadStatus();
  const showDropError = upload.showNotice;

  // Figma config state — from Zustand store
  const figmaPopulated = useStore((state) => state.figmaPopulated);
  const refreshFigmaPopulated = useStore((state) => state.refreshFigmaPopulated);
  // Domain filtering keys off the persisted project SSOT (`config.json`),
  // NOT the mutable `actionMetadata.domain` buffer — the latter holds the
  // previous project's value across a project switch until the config
  // re-fetch lands, which would filter the tree by the wrong domain.
  const projectDomainStatus = useStore((state) => state.projectConfig.status);
  const projectDomain = useStore((state) => state.projectConfig.data?.domain);

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

  /**
   * 413/429 from the upload and download admission gates.
   *
   * These endpoints are bounded by request-total bytes and by simultaneous
   * requests per account, so "too big" and "too many at once" are now ordinary,
   * expected answers and need to read as guidance rather than as a failure.
   */
  const formatLimitError = (error: ApiError): string | null => {
    if (error.code === 'DIRECTORY_DOWNLOAD_LIMIT_EXCEEDED')
      return t('error.downloadTooLarge', { entries: 20000, limitGb: 2 });
    // Upload refusals have ONE owner, shared with the universal and definition
    // panels, so the limits cannot drift from the server's SSOT per screen.
    const refusal = uploadRefusalMessage(error);
    return refusal ? t(refusal.key, refusal.params) : null;
  };

  const format422Error = (error: ApiError, dirPath: string): string => {
    if (error.code === 'INVALID_EXTENSION' && error.allowed)
      return t('error.invalidExtension', { dir: dirPath, allowed: error.allowed.join(', ') });
    if (error.code === 'SUBDIRS_NOT_ALLOWED')
      return t('error.subdirsNotAllowed', { dir: dirPath });
    if (error.code === 'CORRUPTED_FILE')
      return t('error.corruptedFile', { filename: error.filename ?? '' });
    if (error.code === 'BINARY_TARGET')
      return t('error.binaryTarget');
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

  const handleSend = useSendToTransfer(selectedProject, selectedFeature);

  const handleDownload = async (path: string) => {
    if (!selectedProject || !selectedFeature) return;
    // A folder download is a navigation, so a refusal would land as raw JSON in a
    // new tab. Ask first (bounded walk, no archive) and surface a real message.
    const refusal = await preflightDirectoryDownload(selectedProject, selectedFeature, path);
    if (refusal) {
      showError(formatLimitError(refusal) ?? refusal.message, { title: t('common:error.title') });
      return;
    }
    const url = getDownloadUrl(selectedProject, selectedFeature, path);
    window.open(url, '_blank');
  };

  const doUpload = useCallback(
    async (dirPath: string, files: UploadFileEntry[]) => {
      if (notifyArtifactMutationBlocked()) return;
      if (!selectedProject || !selectedFeature) return;

      const signal = upload.begin(files.length, dirPath);

      try {
        const { oversized } = await uploadFiles(selectedProject, selectedFeature, dirPath, files, {
          onProgress: upload.progress,
          signal,
        });
        await refreshFileTree();
        // Past the per-file cap, so never sent — named rather than dropped.
        if (oversized.length > 0) {
          showError(
            t('error.uploadFileTooLarge', { limitMb: UPLOAD_FILE_MAX_BYTES / (1024 * 1024) }),
            { title: t('common:error.title') },
          );
        }
        upload.finish(undefined, oversized.length > 0 ? 'warning' : 'success');
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') {
          console.log('[Upload] Cancelled by user');
        } else if (error instanceof PartialUploadError) {
          // Earlier batches DID land, so the tree must show them.
          await refreshFileTree();
          showError(
            t('error.uploadPartial', {
              done: error.uploadedCount,
              total: error.totalCount,
              reason: error.cause instanceof Error ? error.cause.message : String(error.cause),
            }),
            { title: t('common:error.title') },
          );
        } else if (error instanceof ApiError && error.status === 422) {
          showError(format422Error(error, dirPath), { title: t('common:error.title') });
        } else if (error instanceof ApiError && formatLimitError(error)) {
          showError(formatLimitError(error)!, { title: t('common:error.title') });
        } else {
          console.error('Failed to upload files:', error);
          showError(t('error.uploadFailed'), { title: t('common:error.title') });
        }
        upload.fail();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedProject,
      selectedFeature,
      refreshFileTree,
      showError,
      t,
      upload,
      notifyArtifactMutationBlocked,
    ],
  );

  const { requestUpload: checkConflictsAndUpload, modalProps: conflictModalProps } = useUploadConflicts({
    tree: fileTree,
    upload: doUpload,
    guard: notifyArtifactMutationBlocked,
  });

  const handleUploadEntries = useCallback(
    (dirPath: string, entries: UploadFileEntry[]) => {
      checkConflictsAndUpload(dirPath, entries);
    },
    [checkConflictsAndUpload],
  );

  const prunedFileTree = useMemo(
    () => {
      if (!fileTree?.length) return fileTree;
      // While the project config is loading, skip pruning (show the full tree)
      // rather than prune by an unknown domain — a brief over-inclusive view
      // beats hiding the correct domain's artifacts against a stale value.
      if (projectDomainStatus !== 'ready') return fileTree;
      return pruneFileTreeForWorkspaceDomain(fileTree, projectDomain);
    },
    [fileTree, projectDomainStatus, projectDomain],
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
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      <div
        className="space-y-1"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
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
          onUploadEntries={handleUploadEntries}
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
      <UploadConflictModal {...conflictModalProps} />

      <UploadStatusCard
        status={upload.status}
        notice={upload.notice}
        onCancel={upload.cancel}
        onDismiss={upload.dismiss}
        onDismissNotice={upload.dismissNotice}
      />
    </div>
  );
}
