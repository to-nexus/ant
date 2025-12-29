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
  const { showError } = useAlertModalContext();

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
      
      // If the deleted item was selected, clear the selection
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError('삭제에 실패했습니다.', { title: '오류' });
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

  return {
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleUploadFiles
  };
}
