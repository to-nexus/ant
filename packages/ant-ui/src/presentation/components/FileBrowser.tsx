import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileTree, FileNode } from '@/infrastructure/http/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/presentation/components/common/card';
import { FileIcon } from '@/shared/utils/file-icons';
import { Folder, FolderOpen } from 'lucide-react';

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  onFileSelect: (path: string) => void;
  selectedFile: string | undefined;
}

function FileTreeNode({ node, level, onFileSelect, selectedFile }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Auto-expand first 2 levels

  const handleClick = () => {
    if (node.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(node.path);
    }
  };

  const isSelected = node.type === 'file' && selectedFile === node.path;

  return (
    <div>
      <div
        className={`
          flex items-center gap-2 py-1 px-2 rounded cursor-pointer
          ${isSelected ? 'bg-primary/20 font-medium' : 'hover:bg-muted/50'}
        `}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
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
      {node.type === 'directory' && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileBrowser() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const setFileTree = useStore((state) => state.setFileTree);
  const selectFile = useStore((state) => state.selectFile);
  const connectionStatus = useStore((state) => state.connectionStatus);
  
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setFileTree([]);
      return;
    }

    if (connectionStatus !== 'connected') return;

    loadFileTree();
  }, [selectedProject, selectedFeature, connectionStatus]);

  const loadFileTree = async () => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      setLoading(true);
      const tree = await fetchFileTree(selectedProject, selectedFeature);
      setFileTree(tree);
    } catch (error) {
      console.error('Failed to load file tree:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedProject || !selectedFeature) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File Browser</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Select a project and feature to browse files
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>File Browser</CardTitle>
        <div className="text-xs text-muted-foreground">
          {selectedProject} / {selectedFeature}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : fileTree.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No files found
          </div>
        ) : (
          <div className="space-y-1">
            {fileTree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                level={0}
                onFileSelect={selectFile}
                selectedFile={selectedFile}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
