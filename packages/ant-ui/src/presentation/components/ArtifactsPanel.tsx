import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Package, Folder, FolderOpen, ArrowUpRight, ArrowDownLeft, Upload, X, Check, AlertCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, renameFileOrDirectory, getDownloadUrl, fetchTransferRequests, FileNode } from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { Button } from '@/presentation/components/common/button';
import { textColors, cn } from '@/shared/utils/design-system';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FileActionMenu } from './FeatureDetails/components/FileActionMenu';
import { isCanonicalDir, isStructuralCanonicalDir } from '@/shared/utils/canonical-dirs';
import { extractDroppedFiles } from '@/application/hooks/ui/useDropZone';
import { HintBadge } from '@/presentation/components/common/HintBadge';

const DRAG_EXPAND_DELAY_MS = 600;

interface DirectoryViewProps {
  title: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  onUploadFiles?: (dirPath: string, files: FileList) => void;
  onDropFiles?: (dirPath: string, entries: UploadFileEntry[]) => void;
  onRename?: (oldPath: string, newName: string) => void;
  onDelete?: (filePath: string) => void;
  onSend?: (path: string, type: 'file' | 'directory') => void;
  onDownload?: (path: string) => void;
  onDropError?: (message: string) => void;
  isSessionSection?: boolean;
  unseenArtifacts?: string[];
  onMarkSeen?: (paths: string[]) => void;
  isNarrow?: boolean;
  nodeHints?: Record<string, { label: string; tooltip: string; colorScheme?: 'gray' | 'purple' | 'amber' | 'blue' }>;
}

function DirectoryView({ title, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDropFiles, onRename, onDelete, onSend, onDownload, onDropError, isSessionSection, unseenArtifacts = [], onMarkSeen, isNarrow, nodeHints }: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['inputs', 'outputs']));
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const { showConfirm } = useAlertModalContext();

  // Per-folder drag state — container-level approach using data-drop-dir attribute
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const dragOverPathRef = useRef<string | null>(null);
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandedRef = useRef<Set<string>>(new Set());

  const updateDragTarget = useCallback((dirPath: string | null) => {
    if (dirPath === dragOverPathRef.current) return;
    dragOverPathRef.current = dirPath;
    setDragOverPath(dirPath);

    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    if (dirPath) {
      dragExpandTimerRef.current = setTimeout(() => {
        setExpandedDirs(prev => {
          if (prev.has(dirPath)) return prev;
          const next = new Set(prev);
          next.add(dirPath);
          autoExpandedRef.current.add(dirPath);
          return next;
        });
      }, DRAG_EXPAND_DELAY_MS);
    }
  }, []);

  const clearDragState = useCallback(() => {
    dragOverPathRef.current = null;
    setDragOverPath(null);
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    if (autoExpandedRef.current.size > 0) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        autoExpandedRef.current.forEach(p => next.delete(p));
        return next;
      });
      autoExpandedRef.current.clear();
    }
  }, []);

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
    const hint = isDirectory && nodeHints ? nodeHints[node.name] : undefined;
    const unseenCount = isDirectory ? getUnseenCount(node.path) : 0;
    const isStructural = isDirectory && isStructuralCanonicalDir(node.path);
    const isDragTarget = isDirectory && dragOverPath === node.path;
    const isRenaming = renamingPath === node.path;

    return (
      <div key={node.path}>
        <div
          data-drop-dir={isDirectory && onDropFiles ? node.path : undefined}
          data-drop-blocked={isDirectory && onDropFiles && isStructural ? '' : undefined}
          className={cn(
            'flex items-center justify-between group py-1.5 px-2 rounded transition-colors',
            isSelected 
              ? 'bg-blue-100 dark:bg-blue-900 border-l-2 border-blue-500 dark:border-blue-400 font-medium text-blue-900 dark:text-blue-100' 
              : isDragTarget && !isStructural
                ? 'bg-blue-50 dark:bg-blue-900/30 outline-2 outline-dashed outline-blue-400 dark:outline-blue-500'
                : isDirectory && isExpanded
                  ? 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800',
            isMenuActive && !isDragTarget && (isSelected
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
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameValue.trim() && renameValue.trim() !== node.name) {
                    onRename?.(node.path, renameValue.trim());
                    setRenamingPath(null);
                  } else if (e.key === 'Enter') {
                    setRenamingPath(null);
                  }
                  if (e.key === 'Escape') setRenamingPath(null);
                }}
                onBlur={() => {
                  if (renameValue.trim() && renameValue.trim() !== node.name) {
                    onRename?.(node.path, renameValue.trim());
                  }
                  setRenamingPath(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 px-1 py-0 text-sm border border-blue-400 dark:border-blue-500 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none"
                autoFocus
              />
            ) : (
              <>
                <span className={cn('text-sm truncate', textColors.primary, isUnseen && 'font-semibold')}>{node.name}</span>
                {hint && (
                  <HintBadge
                    label={hint.label}
                    tooltip={hint.tooltip}
                    isCompact={isNarrow}
                    colorScheme={hint.colorScheme}
                    placement="right"
                  />
                )}
                {isDirectory && unseenCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white flex-shrink-0">
                    {unseenCount > 99 ? '99+' : unseenCount}
                  </span>
                )}
                {isUnseen && (
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                )}
              </>
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
                  onCreateFile={node.type === 'directory' && onCreateFile && !isStructural ? () => {
                    setCreateType('file');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onCreateDirectory={node.type === 'directory' && onCreateDirectory && !isStructural ? () => {
                    setCreateType('directory');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  } : undefined}
                  onUpload={node.type === 'directory' && onUploadFiles && !isStructural ? () => {
                    document.getElementById(`upload-${node.path}`)?.click();
                  } : undefined}
                  onRename={onRename && !isClearable ? () => {
                    setRenamingPath(node.path);
                    setRenameValue(node.name);
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
            {node.children.length > 0
              ? node.children.map((child) => renderNode(child, currentLevel + 1))
              : (
                <div
                  className={cn('py-1 text-[11px] italic', textColors.tertiary)}
                  style={{ paddingLeft: `${(currentLevel + 1) * 12 + 8}px` }}
                >
                  {t('panel.emptyDir')}
                </div>
              )
            }
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300 text-center">{title}</h4>
      <div
        className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-96 overflow-y-auto scrollbar-hide"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (onDropFiles) {
            const target = (e.target as HTMLElement).closest('[data-drop-dir]');
            updateDragTarget(target?.getAttribute('data-drop-dir') ?? null);
          }
        }}
        onDragLeave={onDropFiles ? (e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const { clientX, clientY } = e;
          if (clientX <= rect.left || clientX >= rect.right || clientY <= rect.top || clientY >= rect.bottom) {
            clearDragState();
          }
        } : undefined}
        onDrop={async (e) => {
          e.preventDefault();
          clearDragState();
          if (!onDropFiles) {
            onDropError?.(t('error.dropBlockedSection'));
            return;
          }
          const target = (e.target as HTMLElement).closest('[data-drop-dir]');
          if (target?.hasAttribute('data-drop-blocked')) {
            onDropError?.(t('error.dropBlockedCanonical'));
            return;
          }
          const dirPath = target?.getAttribute('data-drop-dir');
          if (dirPath) {
            const entries = await extractDroppedFiles(e.dataTransfer);
            if (entries.length > 0) onDropFiles(dirPath, entries);
          }
        }}
      >
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

  // Drop error notification (shown in the same bottom-center area as upload progress)
  const [dropError, setDropError] = useState<string | null>(null);
  const dropErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showDropError = useCallback((message: string) => {
    if (dropErrorTimerRef.current) clearTimeout(dropErrorTimerRef.current);
    setDropError(message);
    dropErrorTimerRef.current = setTimeout(() => setDropError(null), 3000);
  }, []);

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

  const handleRename = async (oldPath: string, newName: string) => {
    if (!selectedProject || !selectedFeature) return;

    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    if (oldPath === newPath) return;

    try {
      await renameFileOrDirectory(selectedProject, selectedFeature, oldPath, newPath);
      await refreshFileTree();
      if (selectedFile === oldPath) {
        selectFile(newPath);
      }
    } catch (error) {
      console.error('Failed to rename:', error);
      showError(t('error.renameFailed'), { title: t('common:error.title') });
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
    loaded: number;
    total: number;
    fileCount: number;
    targetDir: string;
    completed?: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissUpload = useCallback(() => {
    if (lingerTimerRef.current) { clearTimeout(lingerTimerRef.current); lingerTimerRef.current = null; }
    setUploadState(null);
  }, []);

  const doUpload = useCallback(async (
    dirPath: string,
    files: FileList | UploadFileEntry[],
  ) => {
    if (!selectedProject || !selectedFeature) return;

    const count = Array.isArray(files) ? files.length : files.length;
    const controller = new AbortController();
    abortRef.current = controller;
    dismissUpload();
    setUploadState({ loaded: 0, total: 0, fileCount: count, targetDir: dirPath });

    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files, {
        onProgress: (loaded, total) => setUploadState(prev => prev ? { ...prev, loaded, total } : prev),
        signal: controller.signal,
      });
      await refreshFileTree();
      setUploadState(prev => prev ? { ...prev, loaded: prev.total, completed: true } : prev);
      lingerTimerRef.current = setTimeout(dismissUpload, 3000);
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        console.log('[Upload] Cancelled by user');
      } else {
        console.error('Failed to upload files:', error);
        showError(t('error.uploadFailed'), { title: t('common:error.title') });
      }
      setUploadState(null);
    } finally {
      abortRef.current = null;
    }
  }, [selectedProject, selectedFeature, refreshFileTree, showError, t, dismissUpload]);

  const handleUploadFiles = useCallback(async (dirPath: string, files: FileList) => {
    await doUpload(dirPath, files);
  }, [doUpload]);

  const handleDropFiles = useCallback(async (dirPath: string, entries: UploadFileEntry[]) => {
    await doUpload(dirPath, entries);
  }, [doUpload]);

  const handleCancelUpload = useCallback(() => {
    if (uploadState?.completed) {
      dismissUpload();
    } else {
      abortRef.current?.abort();
    }
  }, [uploadState?.completed, dismissUpload]);

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

  const inputNodeHints: Record<string, { label: string; tooltip: string; colorScheme?: 'gray' | 'purple' | 'amber' | 'blue' }> = {
    references: { label: t('panel.dirHint.references'), tooltip: t('panel.dirHintTooltip.references'), colorScheme: 'purple' },
    assets: { label: t('panel.dirHint.assets'), tooltip: t('panel.dirHintTooltip.assets'), colorScheme: 'purple' },
    sources: { label: t('panel.dirHint.sources'), tooltip: t('panel.dirHintTooltip.sources'), colorScheme: 'amber' },
  };

  const outputNodeHints: Record<string, { label: string; tooltip: string; colorScheme?: 'gray' | 'purple' | 'amber' | 'blue' }> = {
    design: { label: t('panel.dirHint.design'), tooltip: t('panel.dirHintTooltip.design'), colorScheme: 'blue' },
    evals: { label: t('panel.dirHint.evals'), tooltip: t('panel.dirHintTooltip.evals'), colorScheme: 'gray' },
  };

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
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
          nodes={inputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDropFiles={policy.canUploadFiles ? handleDropFiles : undefined}
          onRename={policy.canCreateFile ? handleRename : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
          isNarrow={isNarrow}
          nodeHints={inputNodeHints}
          onDropError={showDropError}
          unseenArtifacts={unseenArtifacts}
          onMarkSeen={markArtifactsSeen}
        />
        <DirectoryView
          title={t('panel.outputs')}
          nodes={outputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDropFiles={policy.canUploadFiles ? handleDropFiles : undefined}
          onRename={policy.canCreateFile ? handleRename : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
          isNarrow={isNarrow}
          nodeHints={outputNodeHints}
          onDropError={showDropError}
          unseenArtifacts={unseenArtifacts}
          onMarkSeen={markArtifactsSeen}
        />
        <DirectoryView
          title={t('panel.sessions')}
          nodes={sessionsNodes}
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          onCreateFile={undefined}
          onCreateDirectory={undefined}
          onUploadFiles={undefined}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onDropError={showDropError}
          isSessionSection={true}
        />

      </div>

      {/* Upload progress toast – fixed bottom-center via portal */}
      {/* Bottom-center portal: upload progress OR drop error */}
      {(uploadState || dropError) && createPortal(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-80 flex flex-col gap-2">
          {uploadState && (
            <div
              className={cn(
                'rounded-xl border shadow-lg p-3 space-y-2 cursor-pointer transition-colors',
                uploadState.completed
                  ? 'border-green-200 dark:border-green-700 bg-white dark:bg-gray-900'
                  : 'border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900',
              )}
              onClick={uploadState.completed ? dismissUpload : undefined}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'flex items-center gap-2 text-xs font-medium truncate',
                  uploadState.completed
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-blue-700 dark:text-blue-300',
                )}>
                  {uploadState.completed
                    ? <Check className="w-3.5 h-3.5 flex-shrink-0" />
                    : <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                  }
                  {uploadState.completed
                    ? t('upload.complete', { count: uploadState.fileCount })
                    : t('upload.uploading', { count: uploadState.fileCount, dir: uploadState.targetDir })
                  }
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancelUpload(); }}
                  className="flex-shrink-0 ml-2 p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title={uploadState.completed ? t('upload.dismiss') : t('upload.cancel')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className={cn(
                'w-full h-2 rounded-full overflow-hidden',
                uploadState.completed ? 'bg-green-100 dark:bg-green-900' : 'bg-blue-100 dark:bg-blue-900',
              )}>
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-200',
                    uploadState.completed ? 'bg-green-500 dark:bg-green-400' : 'bg-blue-500 dark:bg-blue-400',
                  )}
                  style={{ width: uploadState.total > 0 ? `${Math.round((uploadState.loaded / uploadState.total) * 100)}%` : '0%' }}
                />
              </div>
              {uploadState.total > 0 && !uploadState.completed && (
                <div className="text-[10px] text-blue-500 dark:text-blue-400 text-right font-medium">
                  {Math.round((uploadState.loaded / uploadState.total) * 100)}%
                </div>
              )}
            </div>
          )}
          {dropError && (
            <div
              className="relative rounded-xl border border-red-200 dark:border-red-700 bg-white dark:bg-gray-900 shadow-lg p-3 cursor-pointer transition-colors overflow-hidden"
              onClick={() => setDropError(null)}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {dropError}
              </span>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-100 dark:bg-red-900/50">
                <div
                  className="h-full bg-red-500 dark:bg-red-400"
                  style={{ animation: 'shrink-progress 3000ms linear forwards' }}
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