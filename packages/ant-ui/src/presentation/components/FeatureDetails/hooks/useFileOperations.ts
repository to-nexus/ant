import { useTranslation } from 'react-i18next';
import { 
  createFile, 
  createDirectory, 
  uploadFiles, 
  deleteFileOrDirectory 
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function useFileOperations(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  refreshFileTree: () => void
) {
  const selectFile = useStore((state) => state.selectFile);
  const selectedFile = useStore((state) => state.selectedFile);
  const triggerFileReload = useStore((state) => state.triggerFileReload);
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('artifacts');

  const handleCreateFile = async (dirPath: string, fileName: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const fullPath = `${dirPath}/${fileName}`;
      await createFile(selectedProject, selectedFeature, fullPath, '');
      await refreshFileTree();
    } catch (error) {
      console.error('Failed to create file:', error);
      showError(t('error.fileCreateFailed'));
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
      showError(t('error.dirCreateFailed'));
    }
  };

  const handleDelete = async (itemPath: string) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      await deleteFileOrDirectory(selectedProject, selectedFeature, itemPath);
      await refreshFileTree();
      
      // If the deleted item was selected, clear the selection
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError(t('error.deleteFailed'));
    }
  };

  const handleUploadFiles = async (dirPath: string, files: FileList) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const result = await uploadFiles(selectedProject, selectedFeature, dirPath, files);
      await refreshFileTree();

      // ✅ If upload overwrote the currently selected file, immediately refresh editor/preview.
      // Backend returns base filenames; we reconstruct full paths under dirPath.
      const normalizedDir = dirPath && dirPath.length > 0 ? dirPath.replace(/\/+$/, '') : '';
      const uploadedPaths = (result.uploadedFiles || []).map((name) =>
        normalizedDir ? `${normalizedDir}/${name}` : name
      );

      if (selectedFile && uploadedPaths.includes(selectedFile)) {
        triggerFileReload(selectedFile);
      }
    } catch (error) {
      console.error('Failed to upload files:', error);
      showError(t('error.uploadFailed'));
    }
  };

  return {
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleUploadFiles
  };
}
