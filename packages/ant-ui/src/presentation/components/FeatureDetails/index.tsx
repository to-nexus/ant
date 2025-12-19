import { useState } from 'react';
import { useStore } from '@/domain/store';
import { Card, CardHeader, CardTitle, CardContent } from '../common/card';
import { useFileTree } from './hooks/useFileTree';
import { useFileEditor } from './hooks/useFileEditor';
import { useFileOperations } from './hooks/useFileOperations';
import { ArtifactsPanel } from './components/ArtifactsPanel';
import { FileEditor } from './components/FileEditor';

export function FeatureDetails() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const selectFile = useStore((state) => state.selectFile);
  
  const [loading] = useState(false);
  const { fileTree, refreshFileTree } = useFileTree(selectedProject, selectedFeature);
  const {
    editedContent,
    hasChanges,
    saving,
    handleSave,
    handleContentChange,
    loadFileContent
  } = useFileEditor(selectedProject, selectedFeature, selectedFile);
  
  const {
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleUploadFiles
  } = useFileOperations(selectedProject, selectedFeature, refreshFileTree);

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
      <ArtifactsPanel
        selectedProject={selectedProject}
        selectedFeature={selectedFeature}
        loading={loading}
        inputsNodes={inputsNodes}
        outputsNodes={outputsNodes}
        selectedFile={selectedFile}
        onFileSelect={selectFile}
        onCreateFile={handleCreateFile}
        onCreateDirectory={handleCreateDirectory}
        onUploadFiles={handleUploadFiles}
        onDelete={handleDelete}
      />

      {/* File Editor */}
      {selectedFile && (
        <FileEditor
          selectedFile={selectedFile}
          editedContent={editedContent}
          hasChanges={hasChanges}
          saving={saving}
          onContentChange={handleContentChange}
          onSave={handleSave}
          onRevert={loadFileContent}
        />
      )}
    </div>
  );
}
