import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileContent, saveFileContent, createFile, uploadFiles, createDirectory, deleteFileOrDirectory, FileNode } from '@/infrastructure/http/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/presentation/components/common/card';
import { Button } from '@/presentation/components/common/button';
import { Package, Folder, FolderOpen } from 'lucide-react';
import { FileIcon } from '@/shared/utils/file-icons';

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
      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">{title}</h4>
      <div className="border rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 max-h-48 overflow-y-auto">
        {nodes.map((node) => renderNode(node, 0))}
      </div>
    </div>
  );
}

export function FeatureDetails() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const setFileTree = useStore((state) => state.setFileTree);
  const selectFile = useStore((state) => state.selectFile);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const setShowFileEditor = useStore((state) => state.setShowFileEditor);
  
  const [loading] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setFileTree([]);
      return;
    }

    refreshFileTree();
  }, [selectedProject, selectedFeature]);

  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) {
      setFileContent('');
      setEditedContent('');
      setHasChanges(false);
      return;
    }

    loadFileContent();
  }, [selectedProject, selectedFeature, selectedFile]);

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree(); // Refresh the tree
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
      await refreshFileTree(); // Refresh the tree
    } catch (error) {
      console.error('Failed to create directory:', error);
      alert('Failed to create directory');
    }
  };

  const handleDelete = async (itemPath: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await deleteFileOrDirectory(selectedProject, selectedFeature, itemPath);
      await refreshFileTree(); // Refresh the tree
      // If the deleted item was selected, clear the selection and close the editor
      if (selectedFile === itemPath) {
        selectFile('');
        setFileContent('');
        setEditedContent('');
        setHasChanges(false);
        setShowFileEditor(false); // Close the file editor
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
      await refreshFileTree(); // Refresh the tree
    } catch (error) {
      console.error('Failed to upload files:', error);
      alert('Failed to upload files. Note: File upload is not fully implemented yet.');
    }
  };

  const loadFileContent = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      const content = await fetchFileContent(selectedProject, selectedFeature, selectedFile);
      setFileContent(content.content);
      setEditedContent(content.content);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to load file content:', error);
    }
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      setSaving(true);
      await saveFileContent(selectedProject, selectedFeature, selectedFile, editedContent);
      setFileContent(editedContent);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      alert('Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== fileContent);
  };

  if (!selectedProject || !selectedFeature) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Feature Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              Select a project and feature to view details
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Separate inputs and outputs
  const inputsNodes = fileTree.find(node => node.name === 'inputs')?.children || [];
  const outputsNodes = fileTree.find(node => node.name === 'outputs')?.children || [];

  return (
    <div className="space-y-4">
      {/* File Tree */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Artifacts
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            {selectedProject} / {selectedFeature}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <>
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
            </>
          )}
        </CardContent>
      </Card>

      {/* File Editor */}
      {selectedFile && (
        <Card className="flex-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">File Editor</CardTitle>
                <div className="text-xs text-muted-foreground mt-1">
                  {selectedFile}
                  {hasChanges && <span className="text-orange-500 ml-2">● Modified</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadFileContent}
                  disabled={loading || saving || !hasChanges}
                >
                  Revert
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={loading || saving || !hasChanges}
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full h-64 p-3 font-mono text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="File content..."
              spellCheck={false}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}