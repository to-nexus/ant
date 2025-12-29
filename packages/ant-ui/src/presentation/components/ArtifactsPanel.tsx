import { useState, useEffect } from 'react';
import { Package, Folder, FolderOpen } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, FileNode } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import { textColors, cn } from '@/shared/utils/design-system';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { FileIcon } from '@/shared/utils/file-icons';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

interface DirectoryViewProps {
  title: string;
  nodes: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
  onCreateFile?: (dirPath: string, fileName: string) => void;
  onCreateDirectory?: (dirPath: string, dirName: string) => void;
  onUploadFiles?: (dirPath: string, files: FileList) => void;
  onDelete?: (filePath: string) => void;
}

function DirectoryView({ title, nodes, onFileSelect, selectedFile, onCreateFile, onCreateDirectory, onUploadFiles, onDelete }: DirectoryViewProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['inputs', 'outputs']));
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [newFileName, setNewFileName] = useState('');
  const { showConfirm } = useAlertModalContext();

  const toggleDirectory = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const renderNode = (node: FileNode, currentLevel: number) => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.type === 'file' && selectedFile === node.path;
    const isCreatingInThisDir = showCreateForm === node.path;
    const isDirectory = node.type === 'directory';

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center justify-between group py-1.5 px-2 rounded transition-colors',
            isSelected 
              ? 'bg-blue-100 dark:bg-blue-900 border-l-2 border-blue-500 dark:border-blue-400 font-medium text-blue-900 dark:text-blue-100' 
              : isDirectory && isExpanded
                ? 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          style={{ paddingLeft: `${currentLevel * 12 + 8}px` }}
        >
          <div 
            className="flex items-center gap-2 cursor-pointer flex-1"
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
            <span className={cn('text-sm', textColors.primary)}>{node.name}</span>
          </div>
          
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.type === 'directory' && onCreateFile && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateType('file');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  }}
                  title="Create file"
                >
                  📄
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateType('directory');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  }}
                  title="Create directory"
                >
                  📁
                </Button>
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-950"
                  onClick={(e) => {
                    e.stopPropagation();
                    document.getElementById(`upload-${node.path}`)?.click();
                  }}
                  title="Upload files"
                >
                  📤
                </Button>
              </>
            )}
            {/* 삭제 버튼: inputs, outputs의 직계 자식 디렉토리는 삭제 불가 */}
            {onDelete && (() => {
              // inputs 또는 outputs의 직계 자식 디렉토리인지 확인
              const pathParts = node.path.split('/');
              const isDirectChildDir = 
                node.type === 'directory' && 
                pathParts.length === 2 && 
                (pathParts[0] === 'inputs' || pathParts[0] === 'outputs');
              
              // 직계 자식 디렉토리가 아닌 경우에만 삭제 버튼 표시
              return !isDirectChildDir;
            })() && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                onClick={(e) => {
                  e.stopPropagation();
                  showConfirm(`Delete ${node.type} "${node.name}"?`, {
                    type: 'warning',
                    title: 'Delete?',
                    confirmText: 'Delete',
                    cancelText: 'Cancel',
                    onConfirm: () => onDelete(node.path)
                  });
                }}
                title={`Delete ${node.type}`}
              >
                🗑️
              </Button>
            )}
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

export function ArtifactsPanel() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const selectFile = useStore((state) => state.selectFile);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const isSessionRestoring = useStore((state) => state.isSessionRestoring);
  
  // ✅ UI Action Policy
  const policy = useUIActionPolicy();
  const { showError } = useAlertModalContext();

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

  // Note: Real-time file tree updates are now handled by the unified SSE connection in the store

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to create file:', error);
      showError('파일 생성에 실패했습니다.', { title: '오류' });
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
      showError('폴더 생성에 실패했습니다.', { title: '오류' });
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
      showError('삭제에 실패했습니다.', { title: '오류' });
    }
  };

  const handleFileSelect = (path: string) => {
    // DirectoryView uses '' to mean deselect
    selectFile(path);
    if (path && path.length > 0) {
      openMainPanelTab('fileEdit');
    }
  };

  const handleUploadFiles = async (dirPath: string, files: FileList) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files);
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to upload files:', error);
      showError('업로드에 실패했습니다. 잠시 후 다시 시도해주세요.', { title: '오류' });
    }
  };

  // Don't show if no feature is selected
  if (!selectedProject || !selectedFeature) {
    return null;
  }

  // Separate inputs, outputs, and sessions with filtering
  // inputs: only show 'sources' directory
  const allInputsNodes = fileTree?.find(node => node.name === 'inputs')?.children || [];
  const inputsNodes = allInputsNodes.filter(node => node.name === 'sources');
  
  // outputs: only show 'design' and 'reports' directories
  const allOutputsNodes = fileTree?.find(node => node.name === 'outputs')?.children || [];
  const outputsNodes = allOutputsNodes.filter(node => node.name === 'design' || node.name === 'reports');
  
  // sessions: show all
  const sessionsNodes = fileTree?.find(node => node.name === 'sessions')?.children || [];

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <Package className="h-4 w-4" />
        Artifacts
      </h3>
      <div className="space-y-3">
        <DirectoryView
          title="Inputs"
          nodes={inputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          // ✅ UI Policy: 파일 조작은 작업 진행 중에 비활성화
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
        />
        <DirectoryView
          title="Outputs"
          nodes={outputsNodes}
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          // ✅ UI Policy: 파일 조작은 작업 진행 중에 비활성화
          onCreateFile={policy.canCreateFile ? handleCreateFile : undefined}
          onCreateDirectory={policy.canCreateDirectory ? handleCreateDirectory : undefined}
          onUploadFiles={policy.canUploadFiles ? handleUploadFiles : undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
        />
        <DirectoryView
          title="Sessions"
          nodes={sessionsNodes}
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          // ✅ Sessions: read-only except deletion (allow users to clear old session files)
          onCreateFile={undefined}
          onCreateDirectory={undefined}
          onUploadFiles={undefined}
          onDelete={policy.canDeleteFile ? handleDelete : undefined}
        />
      </div>
    </div>
  );
}