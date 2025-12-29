import { useState, useEffect } from 'react';
import { fetchFileContent, saveFileContent } from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function useFileEditor(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  selectedFile: string | undefined
) {
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showError } = useAlertModalContext();

  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) {
      setFileContent('');
      setEditedContent('');
      setHasChanges(false);
      return;
    }

    loadFileContent();
  }, [selectedProject, selectedFeature, selectedFile]);

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
    handleSave,
    handleContentChange,
    loadFileContent
  };
}
