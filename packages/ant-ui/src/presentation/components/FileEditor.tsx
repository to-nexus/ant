import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { fetchFileContent, saveFileContent } from '@/infrastructure/http/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/presentation/components/common/card';
import { Button } from '@/presentation/components/common/button';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function FileEditor() {
  const { t } = useTranslation('artifacts');
  const { showError } = useAlertModalContext();
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileContent = useStore((state) => state.fileContent);
  const setFileContent = useStore((state) => state.setFileContent);
  
  const [editedContent, setEditedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) {
      setFileContent(undefined);
      setEditedContent('');
      setHasChanges(false);
      return;
    }

    loadFileContent();
  }, [selectedProject, selectedFeature, selectedFile]);

  const loadFileContent = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      setLoading(true);
      const content = await fetchFileContent(selectedProject, selectedFeature, selectedFile);
      setFileContent(content);
      setEditedContent(content.content);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to load file content:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      setSaving(true);
      await saveFileContent(selectedProject, selectedFeature, selectedFile, editedContent);
      setFileContent({ path: selectedFile, content: editedContent });
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      showError(t('error.saveFailed'), { title: t('common:error.title') });
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== fileContent?.content);
  };

  if (!selectedProject || !selectedFeature || !selectedFile) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>File Editor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Select a file to edit
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>File Editor</CardTitle>
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
      <CardContent className="flex-1 flex flex-col">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <textarea
            value={editedContent}
            onChange={(e) => handleContentChange(e.target.value)}
            className="flex-1 w-full p-3 font-mono text-sm border rounded-lg resize-none 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white
              border-gray-300 dark:border-gray-600
              focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
              placeholder:text-gray-400 dark:placeholder:text-gray-500"
            placeholder={t('editor.placeholder')}
            spellCheck={false}
          />
        )}
      </CardContent>
    </Card>
  );
}
