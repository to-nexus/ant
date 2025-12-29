import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileContent, saveFileContent } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Eye, FileText } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

interface FileEditorPanelProps {
  onClose?: () => void;
}

export function FileEditorPanel({ onClose }: FileEditorPanelProps) {
  const { showError } = useAlertModalContext();
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'raw' | 'preview'>('raw');
  
  // Check if file is markdown
  const isMarkdownFile = selectedFile?.toLowerCase().match(/\.(md|markdown)$/);
  
  // Reset view mode when file changes or if it's not markdown
  useEffect(() => {
    if (!isMarkdownFile) {
      setViewMode('raw');
    }
  }, [selectedFile, isMarkdownFile]);

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
      showError('저장에 실패했습니다.', { title: '오류' });
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    setHasChanges(newContent !== fileContent);
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 p-4 flex flex-col h-full">
      {/* Header */}
      <div className="pb-3 flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          {/* File path */}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate" title={selectedFile}>
              {selectedFile}
            </div>
            {hasChanges && (
              <div className="text-xs text-orange-500 mt-0.5">● Modified</div>
            )}
          </div>
          
          {/* Preview/Raw Toggle - Only for markdown files */}
          {isMarkdownFile && (
            <div className="flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-900 rounded-md p-1">
              <button
                onClick={() => setViewMode('raw')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
                title="Raw (Edit mode)"
              >
                <FileText className="w-3.5 h-3.5" />
                Raw
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
                title="Preview (Read-only)"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden pt-4">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 p-4">Loading...</div>
        ) : viewMode === 'preview' && isMarkdownFile ? (
          /* Markdown Preview - Read-only */
          <div className="flex-1 overflow-y-auto prose prose-sm dark:prose-invert max-w-none p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {editedContent}
            </ReactMarkdown>
          </div>
        ) : (
          <>
            {/* Raw Editor */}
            <textarea
              value={editedContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="flex-1 w-full p-3 font-mono text-sm border rounded-lg resize-none overflow-y-auto
                bg-white dark:bg-gray-800 
                text-gray-900 dark:text-white
                border-gray-300 dark:border-gray-600
                focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                placeholder:text-gray-400 dark:placeholder:text-gray-500"
              placeholder="File content..."
              spellCheck={false}
            />
            
            {/* Action buttons at the bottom */}
            <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
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