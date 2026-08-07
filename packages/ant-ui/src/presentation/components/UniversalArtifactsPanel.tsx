import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, FolderPlus, Upload, Download, ChevronRight,
  Folder, FolderOpen, File as FileIcon,
} from 'lucide-react';
import { useStore } from '@/domain/store';
import {
  fetchUniversalArtifactsTree,
  uploadUniversalArtifacts,
  getUniversalArtifactDownloadUrl,
  createUniversalArtifactDirectory,
  type UniversalArtifactNode,
} from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import { SectionShell } from './layout/Explorer/SectionShell';
import { Spinner } from '@/presentation/components/common/async';

/**
 * Artifacts tree for universal projects — replaces `ArtifactsPanel`.
 *
 * The universal workspace is a free-form directory (no canonical
 * plan/visual/... domains), so this panel renders the BE tree verbatim:
 * refreshable tree, folder expand/collapse, drag-and-drop / file-picker
 * upload (folder recursion via `extractDroppedFiles`), per-file download,
 * and folder creation. The tree refetches when a job run finishes.
 */
export function UniversalArtifactsPanel({ explorerWidth: _explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation(['artifacts', 'common']);
  const selectedProject = useStore((state) => state.selectedProject);
  const isRunning = useStore((state) => state.isRunning);

  const [tree, setTree] = useState<UniversalArtifactNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string>('');

  const loadTree = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const { tree: nodes } = await fetchUniversalArtifactsTree(selectedProject);
      setTree(nodes);
      setError(null);
    } catch (err) {
      console.error('[UniversalArtifacts] Failed to load tree:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Job finished → outputs may have landed in the workspace.
  useEffect(() => {
    if (!isRunning) void loadTree();
  }, [isRunning, loadTree]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const doUpload = useCallback(async (dirPath: string, entries: UploadFileEntry[]) => {
    if (!selectedProject || entries.length === 0) return;
    setUploading(true);
    try {
      await uploadUniversalArtifacts(selectedProject, dirPath, entries);
      await loadTree();
      if (dirPath) setExpandedDirs((prev) => new Set(prev).add(dirPath));
      setError(null);
    } catch (err) {
      console.error('[UniversalArtifacts] Upload failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [selectedProject, loadTree]);

  const handleDrop = useCallback(async (e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    try {
      const entries = await extractDroppedFiles(e.dataTransfer);
      await doUpload(dirPath, entries);
    } catch (err) {
      console.error('[UniversalArtifacts] Drop failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [doUpload]);

  const openFilePicker = (dirPath: string) => {
    uploadTargetRef.current = dirPath;
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const entries: UploadFileEntry[] = Array.from(files).map((f) => ({
        file: f,
        // File-picker folder uploads carry webkitRelativePath; plain picks don't.
        relativePath: (f as any).webkitRelativePath || f.name,
      }));
      void doUpload(uploadTargetRef.current, entries);
    }
    e.target.value = '';
  };

  const handleDownload = (path: string) => {
    if (!selectedProject) return;
    window.open(getUniversalArtifactDownloadUrl(selectedProject, path), '_blank');
  };

  const handleCreateFolder = async () => {
    if (!selectedProject) return;
    const name = newFolderName.trim();
    if (!name) return;
    const path = newFolderParent ? `${newFolderParent}/${name}` : name;
    try {
      await createUniversalArtifactDirectory(selectedProject, path);
      setNewFolderName('');
      setNewFolderParent(null);
      await loadTree();
      if (newFolderParent) setExpandedDirs((prev) => new Set(prev).add(newFolderParent));
      setError(null);
    } catch (err) {
      console.error('[UniversalArtifacts] mkdir failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!selectedProject) return null;

  const headerButtonStyle: React.CSSProperties = {
    height: 22,
    width: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    color: 'var(--text-3)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all var(--dur-fast)',
  };

  const renderNode = (node: UniversalArtifactNode, depth: number): React.ReactNode => {
    const indent = 8 + depth * 14;
    if (node.type === 'directory') {
      const expanded = expandedDirs.has(node.path);
      const isDragTarget = dragOverPath === node.path;
      return (
        <div key={node.path}>
          <div
            onClick={() => toggleDir(node.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleDir(node.path);
              }
            }}
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverPath(node.path);
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              setDragOverPath((prev) => (prev === node.path ? null : prev));
            }}
            onDrop={(e) => void handleDrop(e, node.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: `4px 8px 4px ${indent}px`,
              borderRadius: 6,
              cursor: 'pointer',
              minWidth: 0,
              background: isDragTarget ? 'var(--select-fill-pink, var(--bg-hover))' : 'transparent',
              outline: isDragTarget ? '1px dashed var(--violet-500)' : 'none',
            }}
          >
            <ChevronRight
              size={10}
              style={{
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 200ms',
                flexShrink: 0,
                color: 'var(--text-3)',
              }}
            />
            {expanded
              ? <FolderOpen size={12} style={{ flexShrink: 0, color: 'var(--orange-500)' }} />
              : <Folder size={12} style={{ flexShrink: 0, color: 'var(--orange-500)' }} />}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                color: 'var(--text-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node.name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFilePicker(node.path);
              }}
              title={t('artifacts:universal.upload', { defaultValue: 'Upload files' })}
              aria-label={t('artifacts:universal.upload', { defaultValue: 'Upload files' })}
              style={{ ...headerButtonStyle, height: 18, width: 18 }}
            >
              <Upload size={10} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setNewFolderParent((prev) => (prev === node.path ? null : node.path));
                setNewFolderName('');
                setExpandedDirs((prev) => new Set(prev).add(node.path));
              }}
              title={t('artifacts:universal.newFolder', { defaultValue: 'New folder' })}
              aria-label={t('artifacts:universal.newFolder', { defaultValue: 'New folder' })}
              style={{ ...headerButtonStyle, height: 18, width: 18 }}
            >
              <FolderPlus size={10} />
            </button>
          </div>
          {expanded && (
            <div>
              {newFolderParent === node.path && renderNewFolderInput(indent + 14)}
              {(node.children ?? []).map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }
    return (
      <div
        key={node.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `4px 8px 4px ${indent + 16}px`,
          borderRadius: 6,
          minWidth: 0,
        }}
      >
        <FileIcon size={12} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
        <span
          className="font-mono"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.path}
        >
          {node.name}
        </span>
        {typeof node.size === 'number' && (
          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
            {formatSize(node.size)}
          </span>
        )}
        <button
          type="button"
          onClick={() => handleDownload(node.path)}
          title={t('artifacts:universal.download', { defaultValue: 'Download' })}
          aria-label={t('artifacts:universal.download', { defaultValue: 'Download' })}
          style={{ ...headerButtonStyle, height: 18, width: 18 }}
        >
          <Download size={10} />
        </button>
      </div>
    );
  };

  const renderNewFolderInput = (indentPx: number) => (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: `2px 8px 2px ${indentPx}px` }}>
      <input
        type="text"
        autoFocus
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleCreateFolder();
          if (e.key === 'Escape') {
            setNewFolderParent(null);
            setNewFolderName('');
          }
        }}
        placeholder={t('artifacts:universal.folderNamePlaceholder', { defaultValue: 'folder-name' })}
        style={{
          flex: 1,
          minWidth: 0,
          height: 24,
          padding: '0 8px',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--text-1)',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-1)',
          outline: 'none',
        }}
      />
      <button
        type="button"
        onClick={() => void handleCreateFolder()}
        disabled={!newFolderName.trim()}
        style={{
          height: 24,
          padding: '0 8px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-on-brand, white)',
          background: 'var(--gradient-aurora)',
          border: 'none',
          cursor: newFolderName.trim() ? 'pointer' : 'not-allowed',
          opacity: newFolderName.trim() ? 1 : 0.5,
        }}
      >
        ✓
      </button>
    </div>
  );

  const isRootDragTarget = dragOverPath === '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <SectionShell
        eyebrow={t('artifacts:universal.title', { defaultValue: 'Workspace' })}
        accent="orange"
        fill
        action={
          <>
            {uploading && (
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                {t('artifacts:universal.uploading', { defaultValue: 'Uploading…' })}
              </span>
            )}
            <button
              type="button"
              onClick={() => openFilePicker('')}
              title={t('artifacts:universal.upload', { defaultValue: 'Upload files' })}
              aria-label={t('artifacts:universal.upload', { defaultValue: 'Upload files' })}
              style={headerButtonStyle}
            >
              <Upload size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                setNewFolderParent((prev) => (prev === '' ? null : ''));
                setNewFolderName('');
              }}
              title={t('artifacts:universal.newFolder', { defaultValue: 'New folder' })}
              aria-label={t('artifacts:universal.newFolder', { defaultValue: 'New folder' })}
              style={headerButtonStyle}
            >
              <FolderPlus size={12} />
            </button>
            <button
              type="button"
              onClick={() => void loadTree()}
              title={t('artifacts:universal.refresh', { defaultValue: 'Refresh' })}
              aria-label={t('artifacts:universal.refresh', { defaultValue: 'Refresh' })}
              style={headerButtonStyle}
            >
              {loading ? <Spinner size="sm" /> : <RefreshCw size={12} />}
            </button>
          </>
        }
      >
        {error && (
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--status-error-fg)' }}>
            {error}
          </div>
        )}
        <div
          className="aurora-scroll"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverPath('');
          }}
          onDragLeave={() => setDragOverPath((prev) => (prev === '' ? null : prev))}
          onDrop={(e) => void handleDrop(e, '')}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 6,
            outline: isRootDragTarget ? '1px dashed var(--violet-500)' : 'none',
            background: isRootDragTarget ? 'var(--bg-hover)' : 'transparent',
          }}
        >
          {newFolderParent === '' && renderNewFolderInput(8)}
          {tree.length === 0 && !loading ? (
            <div
              style={{
                padding: '14px 8px',
                fontSize: 11,
                fontStyle: 'italic',
                color: 'var(--text-3)',
                textAlign: 'center',
              }}
            >
              {t('artifacts:universal.placeholder', { defaultValue: 'Drop files here to add them to the workspace' })}
            </div>
          ) : (
            tree.map((node) => renderNode(node, 0))
          )}
        </div>
      </SectionShell>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
