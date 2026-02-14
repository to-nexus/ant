import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Folder, FolderOpen, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, getDownloadUrl, fetchTransferRequests, FileNode } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import { textColors, cn } from '@/shared/utils/design-system';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { FileActionMenu } from './FeatureDetails/components/FileActionMenu';

interface DirectoryViewProps {
  title: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  onUploadFiles?: (dirPath: string, files: FileList) => void;
  onDelete?: (filePath: string) => void;
  onSend?: (path: string, type: 'file' | 'directory') => void;
  onDownload?: (path: string) => void;
  isSessionSection?: boolean;
  unseenArtifacts?: string[];
  onMarkSeen?: (paths: string[]) => void;
}

function DirectoryView({ title, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDelete, onSend, onDownload, isSessionSection, unseenArtifacts = [], onMarkSeen }: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['inputs', 'outputs']));
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const { showConfirm } = useAlertModalContext();

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
              const pathParts = node.path.split('/');
              const isSession = isSessionSection || node.path.startsWith('sessions');
              const isClearable = 
                node.type === 'directory' &&
                (
                  (pathParts.length === 2 && pathParts[0] === 'outputs') ||
                  (pathParts.length === 3 && pathParts[0] === 'sessions' && (pathParts[2] === 'debug' || pathParts[2] === 'log-prompt'))
                );
              const isProtected = 
                node.type === 'directory' && 
                pathParts.length === 2 && 
                pathParts[0] === 'inputs';

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
                    // Mark ALL (recursive) unseen files under this directory as seen
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
                  onDelete={onDelete && !isProtected && !isClearable ? () => {
                    showConfirm(t('confirm.deleteItem', { type: node.type, name: node.name }), {
                      type: 'warning',
                      title: 'Delete?',
                      confirmText: 'Delete',
                      cancelText: 'Cancel',
                      onConfirm: () => onDelete(node.path)
                    });
                  } : undefined}
                  onClearContents={isClearable && onDelete ? () => {
                    showConfirm(t('confirm.clearContents', { name: node.name }), {
                      type: 'warning',
                      title: 'Clear Contents?',
                      confirmText: 'Clear All',
                      cancelText: 'Cancel',
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
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-96 overflow-y-auto scrollbar-hide">
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

  const handleUploadFiles = async (dirPath: string, files: FileList) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files);
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to upload files:', error);
      showError(t('error.uploadFailed'), { title: t('common:error.title') });
    }
  };

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
          nodes={inputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
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
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onSend={handleSend}
          onDownload={handleDownload}
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
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
          onDownload={handleDownload}
          isSessionSection={true}
        />
      </div>
    </div>
  );
}