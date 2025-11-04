import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { createFile, uploadFiles, createDirectory, deleteFileOrDirectory, FileNode } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';

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
          className={`
            flex items-center justify-between group py-1.5 px-2 rounded transition-colors
            ${isSelected 
              ? 'bg-blue-100 border-l-2 border-blue-500 font-medium text-blue-900' 
              : isDirectory && isExpanded
                ? 'bg-gray-50 hover:bg-gray-100'
                : 'hover:bg-gray-100'
            }
          `}
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
            {node.type === 'directory' && (
              <span className="text-xs">{isExpanded ? '📂' : '📁'}</span>
            )}
            {node.type === 'file' && (
              <span className="text-xs">📄</span>
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
                  title="Create file"
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
                  className="h-6 w-6 p-0 text-gray-600 hover:text-green-600 hover:bg-green-50"
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
            {onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-gray-600 hover:text-red-600 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete ${node.type} "${node.name}"?`)) {
                    onDelete(node.path);
                  }
                }}
                title={`Delete ${node.type}`}
              >
                ❌
              </Button>
            )}
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
      <h4 className="font-medium text-sm mb-2 text-gray-700">{title}</h4>
      <div className="border rounded-lg p-2 bg-gray-50/50">
        {nodes.map((node) => renderNode(node, 0))}
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
  const refreshFileTree = useStore((state) => state.refreshFileTree);

  // Refresh file tree when project or feature changes
  useEffect(() => {
    if (selectedProject && selectedFeature) {
      refreshFileTree();
    }
  }, [selectedProject, selectedFeature, refreshFileTree]);

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('Failed to create file');
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
      alert('Failed to create directory');
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
      alert('Failed to delete item');
    }
  };

  const handleUploadFiles = async (dirPath: string, files: FileList) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await uploadFiles(selectedProject, selectedFeature, dirPath, files);
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to upload files:', error);
      alert('Failed to upload files. Note: File upload is not fully implemented yet.');
    }
  };

  // Don't show if no feature is selected
  if (!selectedProject || !selectedFeature) {
    return null;
  }

  // Separate inputs and outputs
  const inputsNodes = fileTree.find(node => node.name === 'inputs')?.children || [];
  const outputsNodes = fileTree.find(node => node.name === 'outputs')?.children || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">📦 Artifacts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DirectoryView
          title="📝 Inputs"
          nodes={inputsNodes}
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          onCreateFile={handleCreateFile}
          onCreateDirectory={handleCreateDirectory}
          onUploadFiles={handleUploadFiles}
          onDelete={handleDelete}
        />
        <DirectoryView
          title="📄 Outputs"
          nodes={outputsNodes}
          onFileSelect={selectFile}
          selectedFile={selectedFile}
          onCreateFile={handleCreateFile}
          onCreateDirectory={handleCreateDirectory}
          onUploadFiles={handleUploadFiles}
          onDelete={handleDelete}
        />
      </CardContent>
    </Card>
  );
}