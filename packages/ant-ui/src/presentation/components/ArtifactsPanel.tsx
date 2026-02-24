import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Folder, FolderOpen, ArrowUpRight, ArrowDownLeft, Upload, X } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, getDownloadUrl, fetchTransferRequests, FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { Button } from '@/presentation/components/common/button';
import { textColors, cn } from '@/shared/utils/design-system';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FileActionMenu } from './FeatureDetails/components/FileActionMenu';
import { isCanonicalDir } from '@/shared/utils/canonical-dirs';
import { useDropZone } from '@/application/hooks/ui/useDropZone';

interface DirectoryViewProps {
  title: string;
  rootDirName: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  onUploadFiles?: (dirPath: string, files: FileList) => void;
  onDropFiles?: (dirPath: string, entries: UploadFileEntry[]) => void;
  onDelete?: (filePath: string) => void;
  onSend?: (path: string, type: 'file' | 'directory') => void;
  onDownload?: (path: string) => void;
  isSessionSection?: boolean;
  unseenArtifacts?: string[];
  onMarkSeen?: (paths: string[]) => void;
}

function DirectoryView({ title, rootDirName, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDropFiles, onDelete, onSend, onDownload, isSessionSection, unseenArtifacts = [], onMarkSeen }: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['inputs', 'outputs']));
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const { showConfirm } = useAlertModalContext();

  const { isDragOver, dropProps } = useDropZone({
    onDrop: (entries) => {
      if (onDropFiles) onDropFiles(rootDirName, entries);
    },
    disabled: !onDropFiles,
  });

  // Keep a ref to unseenArtifacts so cleanup can read the latest value
  const unseenRef = useRef(unseenArtifacts);
  unseenRef.current = unseenArtifacts;

  // Helper: get direct-child unseen file paths under a directory
  const getDirectChildUnseen = useCallback((dirPath: string): string[] => {
    return unseenRef.current.filter(p => {
      if (!p.startsWith(dirPath + '/')) return false;
      const remainder = p.slice(dirPath.length + 1);
      return !remainder.includes('/'); // direct children only
    });
  }, []);

  const toggleDirectory = (dirPath: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dirPath)) {
      // COLLAPSING: mark direct child files as seen (user already saw them)
      if (onMarkSeen) {
        const childUnseen = getDirectChildUnseen(dirPath);
        if (childUnseen.length > 0) {
          onMarkSeen(childUnseen);
        }
      }
      newExpanded.delete(dirPath);
    } else {
      // EXPANDING: red dots remain visible — user sees them first
      newExpanded.add(dirPath);
    }
    setExpandedDirs(newExpanded);
  };

  // Cleanup on unmount: mark expanded directories' direct children as seen
  useEffect(() => {
    return () => {
      if (!onMarkSeen) return;
      const allChildUnseen: string[] = [];
      expandedDirs.forEach(dirPath => {
        const children = unseenRef.current.filter(p => {
          if (!p.startsWith(dirPath + '/')) return false;
          const remainder = p.slice(dirPath.length + 1);
          return !remainder.includes('/');
        });
        allChildUnseen.push(...children);
      });
      if (allChildUnseen.length > 0) {
        onMarkSeen(allChildUnseen);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: count unseen files under a directory path
  const getUnseenCount = (dirPath: string): number => {
    return unseenArtifacts.filter(p => p.startsWith(dirPath + '/') || p === dirPath).length;
  };

  const renderNode = (node: FileNode, currentLevel: number) => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.type === 'file' && selectedFile === node.path;
    const isCreatingInThisDir = showCreateForm === node.path;
    const isDirectory = node.type === 'directory';
    const isMenuActive = activeMenuPath === node.path;
    const isUnseen = node.type === 'file' && unseenArtifacts.includes(node.path);
    const unseenCount = isDirectory ? getUnseenCount(node.path) : 0;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center justify-between group py-1.5 px-2 rounded transition-colors',
            // Base state: selected > expanded dir > default
            isSelected 
              ? 'bg-blue-100 dark:bg-blue-900 border-l-2 border-blue-500 dark:border-blue-400 font-medium text-blue-900 dark:text-blue-100' 
              : isDirectory && isExpanded
                ? 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800',
            // Menu active overlay: ring + subtle bg (additive, works with any base state)
            isMenuActive && (isSelected
              ? 'ring-1 ring-blue-400 dark:ring-blue-500'
              : 'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-300 dark:ring-amber-600')
          )}
          style={{ paddingLeft: `${currentLevel * 12 + 8}px` }}
        >
          <div 
            className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
            onClick={() => {
              if (node.type === 'directory') {
                toggleDirectory(node.path);
              } else {
                // Toggle file selection - deselect if already selected
                if (selectedFile === node.path) {
                  onFileSelect('');
                } else {
                  onFileSelect(node.path);
                }
              }
            }}
          >
            {node.type === 'directory' ? (
              isExpanded ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
              )
            ) : (
              <FileIcon filePath={node.name} size={16} />
            )}
            <span className={cn('text-sm truncate', textColors.primary, isUnseen && 'font-semibold')}>{node.name}</span>
            {/* Unseen badge for directories */}
            {isDirectory && unseenCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white flex-shrink-0">
                {unseenCount > 99 ? '99+' : unseenCount}
              </span>
            )}
            {/* Unseen dot for files */}
            {isUnseen && (
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            )}
          </div>
          
          {/* Hidden file input for uploads */}
          {node.type === 'directory' && onUploadFiles && (
            <input
              type="file"
              multiple
              className="hidden"
              id={`upload-${node.path}`}
              onChange={(e) => {
                if (e.target.files && onUploadFiles) {
                  onUploadFiles(node.path, e.target.files);
                  e.target.value = '';
                }
              }}
            />
          )}
          <div className={cn("flex items-center gap-1 transition-opacity", isMenuActive ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
            {(() => {
              const isSession = isSessionSection || node.path.startsWith('sessions');
              const isClearable = node.type === 'directory' && isCanonicalDir(node.path);
              const isProtected = false;

              return (
                <FileActionMenu
                  nodePath={node.path}
                  nodeType={node.type as 'file' | 'directory'}
                  nodeName={node.name}
                  isSessionPath={isSession}
                  isProtectedDir={isProtected}
                  isClearableDir={isClearable}
                  onSend={onSend}
                  onDownload={onDownload}
                  onMarkAllSeen={isDirectory && unseenCount > 0 && onMarkSeen ? () => {
                    const allUnseen = unseenArtifacts.filter(p => p.startsWith(node.path + '/') || p === node.path);
                    if (allUnseen.length > 0) {
                      onMarkSeen(allUnseen);
                    }
                  } : undefined}
                  onCreateFile={node.type === 'directory' && onCreateFile ? () => {
                    setCreateType('file');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onCreateDirectory={node.type === 'directory' && onCreateDirectory ? () => {
                    setCreateType('directory');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onUpload={node.type === 'directory' && onUploadFiles ? () => {
                    document.getElementById(`upload-${node.path}`)?.click();
                  } : undefined}
                  onDelete={onDelete && !isClearable ? () => {
                    showConfirm(t('confirm.deleteItem', { type: node.type, name: node.name }), {
                      type: 'warning',
                      title: t('confirm.deleteTitle'),
                      confirmText: t('confirm.deleteType', { type: node.type }),
                      cancelText: t('common:button.cancel'),
                      onConfirm: () => onDelete(node.path)
                    });
                  } : undefined}
                  onClearContents={isClearable && onDelete ? () => {
                    showConfirm(t('confirm.clearContentsDetail', { name: node.name }), {
                      type: 'warning',
                      title: t('confirm.clearContentsTitle'),
                      confirmText: t('confirm.clearAll'),
                      cancelText: t('common:button.cancel'),
                      onConfirm: () => onDelete(node.path)
                    });
                  } : undefined}
                  onOpenChange={(open) => setActiveMenuPath(open ? node.path : null)}
                />
              );
            })()}
          </div>
        </div>
        
        {isCreatingInThisDir && (
          <div className="mt-1 mb-2" style={{ paddingLeft: `${(currentLevel + 1) * 12 + 8}px` }}>
            <div className="flex items-center gap-2">
              <span className={cn('text-xs', textColors.tertiary)}>
                {createType === 'directory' ? '📁' : '📄'}
              </span>
              <input
                type="text"
                placeholder={createType === 'directory' ? "folder-name" : "filename.md"}
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFileName.trim()) {
                    if (createType === 'directory') {
                      onCreateDirectory?.(node.path, newFileName.trim());
                    } else {
                      onCreateFile?.(node.path, newFileName.trim());
                    }
                    setNewFileName('');
                    setShowCreateForm(null);
                  }
                  if (e.key === 'Escape') {
                    setShowCreateForm(null);
                    setNewFileName('');
                  }
                }}
                className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-green-600 dark:text-green-400"
                onClick={() => {
                  if (newFileName.trim()) {
                    if (createType === 'directory') {
                      onCreateDirectory?.(node.path, newFileName.trim());
                    } else {
                      onCreateFile?.(node.path, newFileName.trim());
                    }
                    setNewFileName('');
                    setShowCreateForm(null);
                  }
                }}
              >
                ✓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-red-600 dark:text-red-400"
                onClick={() => {
                  setShowCreateForm(null);
                  setNewFileName('');
                }}
              >
                ✕
              </Button>
            </div>
          </div>
        )}
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, currentLevel + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300 text-center">{title}</h4>
      <div
        {...dropProps}
        className={cn(
          'border rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-96 overflow-y-auto scrollbar-hide relative transition-colors',
          isDragOver
            ? 'border-blue-400 dark:border-blue-500 border-dashed border-2 bg-blue-50/50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-700',
        )}
      >
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50/80 dark:bg-blue-900/40 rounded-lg z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-300 text-sm font-medium">
              <Upload className="w-4 h-4" />
              {t('upload.dropHint')}
            </div>
          </div>
        )}
        {nodes.length === 0 ? (
          <div className={cn('text-sm p-2 text-center', textColors.tertiary)}>
            No files in {title.toLowerCase()}
          </div>
        ) : (
          nodes.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}

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
  
  // ✅ UI Action Policy
  const policy = useUIActionPolicy();
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('artifacts');

  // Hide button labels when explorer is narrow
  const isNarrow = explorerWidth < 260;

  // Refresh file tree when project or feature changes
  useEffect(() => {
    if (!selectedProject || !selectedFeature) return;

    // ✅ Refresh-safe: wait for backend connection and (if applicable) session restore completion.
    // On hard refresh, project/feature can be restored before connection is ready, and the first
    // refresh attempt can be skipped. Also, during session restore, Git branch switching may be
    // in-flight; we refresh after it completes.
    if (connectionStatus !== 'connected') return;
    if (isSessionRestoring) return;

    refreshFileTree();
  }, [selectedProject, selectedFeature, connectionStatus, isSessionRestoring, refreshFileTree]);

  // Fetch pending transfer count when connection is ready and session restore is complete
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    if (!selectedProject || !selectedFeature) return;
    if (isSessionRestoring) return;
    fetchTransferRequests('received')
      .then(({ pendingCount }) => setPendingTransferCount(pendingCount))
      .catch(() => {});
  }, [connectionStatus, selectedProject, selectedFeature, isSessionRestoring, setPendingTransferCount]);

  // Note: Real-time file tree updates are now handled by the unified SSE connection in the store

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to create file:', error);
      showError(t('error.fileCreateFailed'), { title: t('common:error.title') });
    }
  };

  const handleCreateDirectory = async (dirPath: string, dirName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${dirName}`;
      await createDirectory(selectedProject, selectedFeature, fullPath);
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to create directory:', error);
      showError(t('error.dirCreateFailed'), { title: t('common:error.title') });
    }
  };

  const handleDelete = async (itemPath: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await deleteFileOrDirectory(selectedProject, selectedFeature, itemPath);
      await refreshFileTree();
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError(t('error.deleteFailed'), { title: t('common:error.title') });
    }
  };

  const handleFileSelect = (path: string) => {
    // DirectoryView uses '' to mean deselect
    selectFile(path);
    if (path && path.length > 0) {
      openMainPanelTab('fileEdit');
      // Mark file as seen if it's in the unseen list
      if (unseenArtifacts?.includes(path)) {
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
    active: boolean;
    loaded: number;
    total: number;
    fileCount: number;
    targetDir: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doUpload = useCallback(async (
    dirPath: string,
    files: FileList | UploadFileEntry[],
  ) => {
    if (!selectedProject || !selectedFeature) return;

    const count = Array.isArray(files) ? files.length : files.length;
    const controller = new AbortController();
    abortRef.current = controller;
    setUploadState({ active: true, loaded: 0, total: 0, fileCount: count, targetDir: dirPath });

    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files, {
        onProgress: (loaded, total) => setUploadState(prev => prev ? { ...prev, loaded, total } : prev),
        signal: controller.signal,
      });
      await refreshFileTree();
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        console.log('[Upload] Cancelled by user');
      } else {
        console.error('Failed to upload files:', error);
        showError(t('error.uploadFailed'), { title: t('common:error.title') });
      }
    } finally {
      setUploadState(null);
      abortRef.current = null;
    }
  }, [selectedProject, selectedFeature, refreshFileTree, showError, t]);

  const handleUploadFiles = useCallback(async (dirPath: string, files: FileList) => {
    await doUpload(dirPath, files);
  }, [doUpload]);

  const handleDropFiles = useCallback(async (dirPath: string, entries: UploadFileEntry[]) => {
    await doUpload(dirPath, entries);
  }, [doUpload]);

  const handleCancelUpload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Don't show if no feature is selected
  if (!selectedProject || !selectedFeature) {
    return null;
  }

  // Separate inputs, outputs, and sessions with filtering
  // inputs: show 'sources' + 'assets' + 'references'
  const allInputsNodes = fileTree?.find(node => node.name === 'inputs')?.children || [];
  const inputsNodes = allInputsNodes.filter(node =>
    node.name === 'sources' || node.name === 'assets' || node.name === 'references'
  );
  
  // outputs: show 'design', 'plan', 'evals', and 'reports' directories
  const allOutputsNodes = fileTree?.find(node => node.name === 'outputs')?.children || [];
  const outputsNodes = allOutputsNodes.filter(node => 
    node.name === 'design' || node.name === 'plan' || node.name === 'evals' || node.name === 'reports'
  );
  
  // sessions: show all
  const sessionsNodes = fileTree?.find(node => node.name === 'sessions')?.children || [];

  return (
    <div className="space-y-3">
      <h3 className="flex items-center justify-between text-sm font-semibold text-gray-900 dark:text-white">
        <span className="flex items-center gap-2 min-w-0">
          <Package className="h-4 w-4 shrink-0" />
          <span className="truncate">{t('panel.title')}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            onClick={() => openTransferTab({ subTab: 'send' })}
            title={t('panel.send')}
          >
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            {!isNarrow && <span>{t('panel.send')}</span>}
          </button>
          <button
            className="relative inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            onClick={() => openTransferTab({ subTab: 'receive' })}
            title={t('panel.receive')}
          >
            <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
            {!isNarrow && <span>{t('panel.receive')}</span>}
            {pendingTransferCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {pendingTransferCount > 99 ? '99+' : pendingTransferCount}
              </span>
            )}
          </button>
        </span>
      </h3>
      <div className="space-y-3">
        <DirectoryView
          title={t('panel.inputs')}
          rootDirName="inputs"
          nodes={inputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDropFiles={policy.canUploadFiles ? handleDropFiles : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
          unseenArtifacts={unseenArtifacts}
          onMarkSeen={markArtifactsSeen}
        />
        <DirectoryView
          title={t('panel.outputs')}
          rootDirName="outputs"
          nodes={outputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDropFiles={policy.canUploadFiles ? handleDropFiles : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
          unseenArtifacts={unseenArtifacts}
          onMarkSeen={markArtifactsSeen}
        />
        <DirectoryView
          title={t('panel.sessions')}
          rootDirName="sessions"
          nodes={sessionsNodes}
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          onCreateFile={undefined}
          onCreateDirectory={undefined}
          onUploadFiles={undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onDownload={handleDownload}
          isSessionSection={true}
        />

        {/* Upload progress bar */}
        {uploadState && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate">
                {t('upload.uploading', { count: uploadState.fileCount, dir: uploadState.targetDir })}
              </span>
              <button
                onClick={handleCancelUpload}
                className="flex-shrink-0 ml-2 p-0.5 rounded hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-500 dark:text-blue-400 transition-colors"
                title={t('upload.cancel')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-[width] duration-200"
                style={{ width: uploadState.total > 0 ? `${Math.round((uploadState.loaded / uploadState.total) * 100)}%` : '0%' }}
              />
            </div>
            {uploadState.total > 0 && (
              <div className="text-[10px] text-blue-500 dark:text-blue-400 text-right">
                {Math.round((uploadState.loaded / uploadState.total) * 100)}%
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}