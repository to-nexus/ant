import { useState, useEffect } from 'react';
import { fetchFileBlob, fetchFileContent, isBinaryImageFilePath, saveFileContent } from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';

export function useFileEditor(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  selectedFile: string | undefined
) {
  const fileReloadTrigger = useStore((s) => s.fileReloadTrigger);
  const fileReloadTarget = useStore((s) => s.fileReloadTarget);
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null);
  const { showError } = useAlertModalContext();

  const isImageFile = isBinaryImageFilePath(selectedFile);

  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) {
      setFileContent('');
      setEditedContent('');
      setHasChanges(false);
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl(null);
      }
      return;
    }

    loadFileContent();
  }, [selectedProject, selectedFeature, selectedFile]);

  // ✅ Force reload when upload overwrote this file (even if selectedFile didn't change)
  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (!fileReloadTrigger) return;
    if (fileReloadTarget && fileReloadTarget !== selectedFile) return;
    loadFileContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileReloadTrigger]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
      }
    };
  }, [binaryPreviewUrl]);

  const loadFileContent = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl(null);
      }

      if (isImageFile) {
        const blob = await fetchFileBlob(selectedProject, selectedFeature, selectedFile);
        const url = URL.createObjectURL(blob);
        setBinaryPreviewUrl(url);
        setFileContent('');
        setEditedContent('');
        setHasChanges(false);
      } else {
        const content = await fetchFileContent(selectedProject, selectedFeature, selectedFile);
        setFileContent(content.content);
        setEditedContent(content.content);
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Failed to load file content:', error);
    }
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (isImageFile) return;
    
    try {
      setSaving(true);
      await saveFileContent(selectedProject, selectedFeature, selectedFile, editedContent);
      setFileContent(editedContent);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      showError('저장에 실패했습니다.', { title: '오류' });
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== fileContent);
  };

  return {
    fileContent,
    editedContent,
    hasChanges,
    saving,
    isImageFile,
    binaryPreviewUrl,
    handleSave,
    handleContentChange,
    loadFileContent
  };
}
