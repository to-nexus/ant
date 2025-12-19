import { 
  createFile, 
  createDirectory, 
  uploadFiles, 
  deleteFileOrDirectory 
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export function useFileOperations(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  refreshFileTree: () => void
) {
  const selectFile = useStore((state) => state.selectFile);
  const selectedFile = useStore((state) => state.selectedFile);

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
      
      // If the deleted item was selected, clear the selection
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

  return {
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleUploadFiles
  };
}
