import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { UI_PANEL_TOP_LEVEL_DIRS, getUniversalArtifactDirPolicy, type ArtifactPermissions } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import {
  fetchUniversalArtifactsTree,
  uploadUniversalArtifacts,
  getUniversalArtifactDownloadUrl,
  createUniversalArtifactDirectory,
  createUniversalArtifactFile,
  renameUniversalArtifact,
  deleteUniversalArtifact,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { ArtifactsSection } from './ArtifactsPanel/ArtifactsSection';

/**
 * Artifacts tree for universal (workspace) projects — the same surface as
 * the codespace `ArtifactsPanel`, composed from the SAME shared pieces
 * (`ArtifactsSection` → `ArtifactRow` → `FileActionMenu`), so header, rows,
 * menus, permissions, and i18n stay consistent across project kinds.
 *
 * Differences from the codespace mount are data-shaped, not UI-shaped:
 *  - the tree comes from the universal artifacts API (BE grafts the
 *    canonical `plan` dir first and the `sessions` node last);
 *  - the root itself is writable (`rootDirPath=''`), so the section header
 *    carries the shared ⋯ menu for root-level create/upload;
 *  - Transfer is not wired yet (future), so no header toolbar.
 */
export function UniversalArtifactsPanel({ explorerWidth: _explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation(['artifacts', 'common']);
  const selectedProject = useStore((state) => state.selectedProject);
  const isRunning = useStore((state) => state.isRunning);
  // fileTree SSE tick — tool-node writes broadcast notifyFileTreeUpdate;
  // the panel's own tree comes from the universal artifacts API, so the
  // shared fileTree state is used purely as a refresh trigger.
  const fileTreeTick = useStore((state) => state.fileTree);
  const { showError } = useAlertModalContext();

  // Canonical mirror: file selection lives in fileSlice/uiSlice so a click
  // opens the shared FileEditorPanel (universalSlice pins selectedFeature to
  // 'universal', so openFile/save resolve against the container seam).
  const selectedFile = useStore((state) => state.selectedFile);
  const selectFile = useStore((state) => state.selectFile);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);

  const [tree, setTree] = useState<FileNode[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadTree = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const { tree: nodes } = await fetchUniversalArtifactsTree(selectedProject);
      setTree(nodes as unknown as FileNode[]);
    } catch (err) {
      console.error('[UniversalArtifacts] Failed to load tree:', err);
    }
  }, [selectedProject]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Job finished → outputs may have landed in the workspace.
  useEffect(() => {
    if (!isRunning) void loadTree();
  }, [isRunning, loadTree]);

  // Live refresh during the run: each fileTree SSE update means a write
  // landed in the container.
  useEffect(() => {
    if (isRunning) void loadTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTreeTick]);

  const surfaceError = useCallback(
    (err: unknown) => {
      showError(err instanceof Error ? err.message : String(err));
    },
    [showError],
  );

  const mutate = useCallback(
    async (op: () => Promise<unknown>) => {
      if (!selectedProject) return;
      try {
        await op();
        await loadTree();
      } catch (err) {
        console.error('[UniversalArtifacts] Mutation failed:', err);
        surfaceError(err);
      }
    },
    [selectedProject, loadTree, surfaceError],
  );

  const joinDir = (dirPath: string, name: string) => (dirPath ? `${dirPath}/${name}` : name);

  const doUpload = useCallback(
    async (dirPath: string, entries: UploadFileEntry[]) => {
      if (!selectedProject || entries.length === 0) return;
      setUploading(true);
      try {
        await uploadUniversalArtifacts(selectedProject, dirPath, entries);
        await loadTree();
      } catch (err) {
        console.error('[UniversalArtifacts] Upload failed:', err);
        surfaceError(err);
      } finally {
        setUploading(false);
      }
    },
    [selectedProject, loadTree, surfaceError],
  );

  // Sessions subtree carries the SAME restricted permissions as the
  // codespace sessions row — SSOT: the canonical UI_PANEL_TOP_LEVEL_DIRS
  // entry (delete/download only).
  const sessionsPermissions = useMemo<ArtifactPermissions | undefined>(
    () => UI_PANEL_TOP_LEVEL_DIRS.find((d) => d.name === 'sessions')?.permissions,
    [],
  );
  const getNodePermissions = useCallback(
    (path: string): ArtifactPermissions | undefined =>
      path.split('/')[0] === 'sessions' ? sessionsPermissions : undefined,
    [sessionsPermissions],
  );

  if (!selectedProject) return null;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      <ArtifactsSection
        title={t('artifacts:panel.title', 'Artifacts')}
        accent="orange"
        nodes={tree}
        sectionPrefix={undefined}
        rootDirPath=""
        headerAction={
          uploading ? (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {t('artifacts:universal.uploading', { defaultValue: 'Uploading…' })}
            </span>
          ) : undefined
        }
        getNodePermissions={getNodePermissions}
        resolveDirPolicy={getUniversalArtifactDirPolicy}
        onFileSelect={(path) => {
          // ArtifactsSection uses '' to mean deselect.
          selectFile(path);
          if (path && path.length > 0) {
            openMainPanelTab('fileEdit');
          }
        }}
        selectedFile={selectedFile || undefined}
        onCreateFile={(dirPath, fileName) =>
          void mutate(() => createUniversalArtifactFile(selectedProject, joinDir(dirPath, fileName)))
        }
        onCreateDirectory={(dirPath, dirName) =>
          void mutate(() => createUniversalArtifactDirectory(selectedProject, joinDir(dirPath, dirName)))
        }
        onUploadFiles={(dirPath, files) =>
          void doUpload(
            dirPath,
            Array.from(files).map((f) => ({
              file: f,
              relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
            })),
          )
        }
        onDropFiles={(dirPath, entries) => void doUpload(dirPath, entries)}
        onRename={(oldPath, newName) =>
          void mutate(() => renameUniversalArtifact(selectedProject, oldPath, newName))
        }
        onDelete={(filePath) => void mutate(() => deleteUniversalArtifact(selectedProject, filePath))}
        onDownload={(path) =>
          window.open(getUniversalArtifactDownloadUrl(selectedProject, path), '_blank')
        }
        onDropError={(message) => showError(message)}
      />
    </div>
  );
}
