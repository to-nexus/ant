import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  createFile, 
  createDirectory, 
  uploadFiles, 
  deleteFileOrDirectory 
} from '@/infrastructure/http/api';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import type { ConflictResolution } from '@/presentation/components/common/UploadConflictModal';
import { findConflicts, getAllExistingNames, applyPerFileResolutions, fileListToEntries } from '@/shared/utils/upload-utils';

export function useFileOperations(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  refreshFileTree: () => void
) {
  const selectFile = useStore((state) => state.selectFile);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileTree = useStore((state) => state.fileTree);
  const triggerFileReload = useStore((state) => state.triggerFileReload);
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('artifacts');

  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    conflictingFiles: string[];
    dirPath: string;
    entries: UploadFileEntry[];
  }>({ isOpen: false, conflictingFiles: [], dirPath: '', entries: [] });

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
      
      if (selectedFile === itemPath) {
        selectFile('');
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError(t('error.deleteFailed'));
    }
  };

  const doUpload = useCallback(async (dirPath: string, entries: UploadFileEntry[]) => {
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const result = await uploadFiles(selectedProject, selectedFeature, dirPath, entries);
      await refreshFileTree();

      const normalizedDir = dirPath && dirPath.length > 0 ? dirPath.replace(/\/+$/, '') : '';
      const uploadedPaths = (result.uploadedFiles || []).map((name: string) =>
        normalizedDir ? `${normalizedDir}/${name}` : name
      );

      if (selectedFile && uploadedPaths.includes(selectedFile)) {
        triggerFileReload(selectedFile);
      }
    } catch (error) {
      console.error('Failed to upload files:', error);
      showError(t('error.uploadFailed'));
    }
  }, [selectedProject, selectedFeature, refreshFileTree, selectedFile, triggerFileReload, showError, t]);

  const handleUploadFiles = useCallback((dirPath: string, files: FileList) => {
    const entries = fileListToEntries(files);
    if (!fileTree) {
      doUpload(dirPath, entries);
      return;
    }
    const conflicts = findConflicts(fileTree, dirPath, entries);
    if (conflicts.length === 0) {
      doUpload(dirPath, entries);
      return;
    }
    setConflictModal({ isOpen: true, conflictingFiles: conflicts, dirPath, entries });
  }, [fileTree, doUpload]);

  const handleConflictResolve = useCallback((resolution: ConflictResolution) => {
    const { dirPath, entries } = conflictModal;
    setConflictModal(prev => ({ ...prev, isOpen: false }));

    if (resolution === 'cancel') return;

    const existingNames = fileTree ? getAllExistingNames(fileTree, dirPath) : [];
    const finalEntries = applyPerFileResolutions(entries, resolution.perFile, existingNames);
    doUpload(dirPath, finalEntries);
  }, [conflictModal, doUpload, fileTree]);

  return {
    handleCreateFile,
    handleCreateDirectory,
    handleDelete,
    handleUploadFiles,
    conflictModal,
    setConflictModal,
    handleConflictResolve,
  };
}
