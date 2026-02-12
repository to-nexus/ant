import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, FolderOpen } from 'lucide-react';
import { FileNode } from '@/infrastructure/http/api';
import { Button } from '../../common/button';
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

export function DirectoryView({ 
  title, 
  nodes, 
  onFileSelect, 
  selectedFile, 
  onCreateFile, 
  onCreateDirectory, 
  onUploadFiles, 
  onDelete 
}: DirectoryViewProps) {
  const { t } = useTranslation('artifacts');
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

  const renderNode = (node: FileNode, currentLevel: number): JSX.Element => {
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.type === 'file' && selectedFile === node.path;
    const isCreatingInThisDir = showCreateForm === node.path;

    return (
      <div key={node.path}>
        <div
          className={`
            flex items-center justify-between group py-1 px-2 rounded
            ${isSelected ? 'bg-primary/20 font-medium' : 'hover:bg-muted/50'}
          `}
          style={{ paddingLeft: `${currentLevel * 12 + 8}px` }}
        >
          <div 
            className="flex items-center gap-2 cursor-pointer flex-1"
            onClick={() => {
              if (node.type === 'directory') {
                toggleDirectory(node.path);
              } else {
                onFileSelect(node.path);
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
            <span className="text-sm">{node.name}</span>
          </div>
          
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.type === 'directory' && onCreateFile && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 hover:text-blue-600 hover:bg-blue-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateType('file');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  }}
                  title={t('actions.createFile')}
                >
                  📄
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 hover:text-purple-600 hover:bg-purple-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateType('directory');
                    setShowCreateForm(isCreatingInThisDir ? null : node.path);
                    setNewFileName('');
                  }}
                  title={t('actions.createDirectory')}
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
                  className="h-6 w-6 p-0 text-gray-600 hover:text-green-600 hover:bg-green-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    document.getElementById(`upload-${node.path}`)?.click();
                  }}
                  title={t('actions.upload')}
                >
                  📤
                </Button>
              </>
            )}
            {/* 삭제 버튼 로직 */}
            {onDelete && (() => {
              const pathParts = node.path.split('/');
              
              // "Clear contents" 대상 폴더들 (폴더는 유지, 하위 파일만 삭제)
              const isClearableDir = 
                node.type === 'directory' &&
                (
                  // outputs의 직계 자식 디렉토리들 (design, reports, debug 등)
                  (pathParts.length === 2 && pathParts[0] === 'outputs') ||
                  // sessions/{agent}/debug, sessions/{agent}/log-prompt (agent-nested)
                  (pathParts.length === 3 && pathParts[0] === 'sessions' && (pathParts[2] === 'debug' || pathParts[2] === 'log-prompt'))
                );
              
              // inputs의 직계 자식 디렉토리는 삭제 불가
              const isProtectedInputsDir = 
                node.type === 'directory' && 
                pathParts.length === 2 && 
                pathParts[0] === 'inputs';
              
              if (isClearableDir) {
                // 하위 파일 전체 삭제 버튼 (폴더는 유지)
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-gray-600 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      showConfirm(t('confirm.clearContentsDetail', { name: node.name }), {
                        type: 'warning',
                        title: 'Clear Contents?',
                        confirmText: 'Clear All',
                        cancelText: 'Cancel',
                        onConfirm: () => onDelete(node.path)
                      });
                    }}
                    title={t('actions.clearContents')}
                  >
                    🗑️
                  </Button>
                );
              }
              
              // inputs의 직계 자식 디렉토리는 버튼 없음
              if (isProtectedInputsDir) {
                return null;
              }
              
              // 일반 파일/폴더: 삭제 버튼
              return (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-600 hover:text-red-600 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    showConfirm(t('confirm.deleteItem', { type: node.type, name: node.name }), {
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
              );
            })()}
          </div>
        </div>
        
        {isCreatingInThisDir && (
          <div className="mt-1 mb-2" style={{ paddingLeft: `${(currentLevel + 1) * 12 + 8}px` }}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
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
                className="flex-1 px-2 py-1 text-xs border rounded"
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-green-600"
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
                className="h-6 w-6 p-0 text-red-600"
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

  if (nodes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No files in {title.toLowerCase()}
      </div>
    );
  }

  return (
    <div>
      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">{title}</h4>
      <div className="border rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-48 overflow-y-auto">
        {nodes.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}
