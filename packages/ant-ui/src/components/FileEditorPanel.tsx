import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { fetchFileContent, saveFileContent } from '@/lib/api';
import { Button } from '@/ui/button';

interface FileEditorPanelProps {
  onClose?: () => void;
}

export function FileEditorPanel({ onClose }: FileEditorPanelProps) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

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
      setLoading(true);
      const content = await fetchFileContent(selectedProject, selectedFeature, selectedFile);
      setFileContent(content.content);
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
      setFileContent(editedContent);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      alert('Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== fileContent);
  };

  return (
    <div className="w-96 bg-white border-r border-gray-200 p-4 flex flex-col h-full">
      {/* Header */}
      <div className="pb-3 flex-shrink-0 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {/* Close button on the left */}
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded transition-colors flex-shrink-0"
              title="Hide Editor"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          {/* File path - takes full width */}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 truncate" title={selectedFile}>
              {selectedFile}
            </div>
            {hasChanges && (
              <div className="text-xs text-orange-500 mt-0.5">● Modified</div>
            )}
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden pt-4">
        {loading ? (
          <div className="text-sm text-muted-foreground p-4">Loading...</div>
        ) : (
          <>
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="flex-1 w-full p-3 font-mono text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary overflow-y-auto"
              placeholder="File content..."
              spellCheck={false}
            />
            
            {/* Action buttons at the bottom */}
            <div className="flex gap-2 justify-end mt-3 pt-3 border-t flex-shrink-0">
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
          </>
        )}
      </div>
    </div>
  );
}