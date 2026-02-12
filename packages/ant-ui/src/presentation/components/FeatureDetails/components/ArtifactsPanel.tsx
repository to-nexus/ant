import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../common/card';
import { FileNode } from '@/infrastructure/http/api';
import { DirectoryView } from './DirectoryView';

interface ArtifactsPanelProps {
  selectedProject: string;
  selectedFeature: string;
  loading: boolean;
  inputsNodes: FileNode[];
  outputsNodes: FileNode[];
  selectedFile: string | undefined;
  onFileSelect: (path: string) => void;
  onCreateFile: (dirPath: string, fileName: string) => void;
  onCreateDirectory: (dirPath: string, dirName: string) => void;
  onUploadFiles: (dirPath: string, files: FileList) => void;
  onDelete: (filePath: string) => void;
}

export function ArtifactsPanel({
  selectedProject,
  selectedFeature,
  loading,
  inputsNodes,
  outputsNodes,
  selectedFile,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onUploadFiles,
  onDelete
}: ArtifactsPanelProps) {
  const { t } = useTranslation('artifacts');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t('featureDetails.artifacts')}
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {selectedProject} / {selectedFeature}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">{t('common:status.loading')}</div>
        ) : (
          <>
            <DirectoryView
              title={t('featureDetails.inputs')}
              nodes={inputsNodes}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              onCreateFile={onCreateFile}
              onCreateDirectory={onCreateDirectory}
              onUploadFiles={onUploadFiles}
              onDelete={onDelete}
            />
            <DirectoryView
              title={t('featureDetails.outputs')}
              nodes={outputsNodes}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              onCreateFile={onCreateFile}
              onCreateDirectory={onCreateDirectory}
              onUploadFiles={onUploadFiles}
              onDelete={onDelete}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
