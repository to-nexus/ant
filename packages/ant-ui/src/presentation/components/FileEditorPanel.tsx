import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchFileBlob, fetchFileContent, isBinaryImageFilePath, isSvgFilePath, saveFileContent } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Eye, FileText } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { JsonYamlPreview } from './JsonYamlPreview';

interface FileEditorPanelProps {
  onClose?: () => void;
}

export function FileEditorPanel({ onClose: _onClose }: FileEditorPanelProps) {
  const { showError } = useAlertModalContext();
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const fileReloadTrigger = useStore((state) => state.fileReloadTrigger);
  const fileReloadTarget = useStore((state) => state.fileReloadTarget);
  const lastViewMode = useStore((state) => state.lastViewMode);
  const setLastViewMode = useStore((state) => state.setLastViewMode);
  
  const [fileContent, setFileContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'raw' | 'preview'>('raw');
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null);
  const [svgPreviewUrl, setSvgPreviewUrl] = useState<string | null>(null);
  
  // Check file types for preview support
  const isMarkdownFile = selectedFile?.toLowerCase().match(/\.(md|markdown)$/);
  const isSvgFile = isSvgFilePath(selectedFile);
  const isBinaryImageFile = isBinaryImageFilePath(selectedFile);
  const isJsonFile = selectedFile?.toLowerCase().match(/\.json$/);
  const isYamlFile = selectedFile?.toLowerCase().match(/\.(yaml|yml)$/);
  
  // 파일이 두 가지 이상 모드를 지원하는지 확인
  const hasMultipleModes = (isMarkdownFile || isSvgFile || isJsonFile || isYamlFile) && !isBinaryImageFile;
  
  // Apply last view mode when file changes (only for files with multiple modes)
  useEffect(() => {
    if (hasMultipleModes) {
      // 두 가지 모드를 지원하는 파일: 마지막 보기 모드 적용
      setViewMode(lastViewMode);
    } else {
      // 하나의 모드만 지원하는 파일: raw 모드로 설정하되 lastViewMode는 업데이트하지 않음
      setViewMode('raw');
    }
  }, [selectedFile, hasMultipleModes, lastViewMode]);

  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) {
      setFileContent('');
      setEditedContent('');
      setHasChanges(false);
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl(null);
      }
      if (svgPreviewUrl) {
        URL.revokeObjectURL(svgPreviewUrl);
        setSvgPreviewUrl(null);
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
      if (svgPreviewUrl) {
        URL.revokeObjectURL(svgPreviewUrl);
      }
    };
  }, [binaryPreviewUrl, svgPreviewUrl]);

  // Build/refresh SVG preview URL from edited content (preview mode only)
  useEffect(() => {
    if (!isSvgFile) return;
    if (viewMode !== 'preview') return;
    if (!editedContent) return;

    if (svgPreviewUrl) {
      URL.revokeObjectURL(svgPreviewUrl);
      setSvgPreviewUrl(null);
    }

    const blob = new Blob([editedContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    setSvgPreviewUrl(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSvgFile, viewMode, editedContent]);

  const loadFileContent = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    
    try {
      setLoading(true);
      // Reset previous image preview URL if any
      if (binaryPreviewUrl) {
        URL.revokeObjectURL(binaryPreviewUrl);
        setBinaryPreviewUrl(null);
      }
      if (svgPreviewUrl) {
        URL.revokeObjectURL(svgPreviewUrl);
        setSvgPreviewUrl(null);
      }

      if (isBinaryImageFile) {
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
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (isBinaryImageFile) return; // Binary files are not editable here
    
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

  // 보기 모드 변경 핸들러 (두 가지 모드를 지원하는 파일에서만 store 업데이트)
  const handleViewModeChange = (mode: 'raw' | 'preview') => {
    setViewMode(mode);
    if (hasMultipleModes) {
      setLastViewMode(mode);
    }
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
          
          {/* Binary image actions (Reload / Open) */}
          {isBinaryImageFile && (
            <div className="flex items-center gap-2 ml-4">
              <Button
                size="sm"
                variant="outline"
                onClick={loadFileContent}
                disabled={loading || saving}
              >
                Reload
              </Button>
              {binaryPreviewUrl && (
                <Button size="sm" variant="ghost" asChild>
                  <a
                    href={binaryPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="새 탭에서 열기"
                  >
                    Open
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Preview/Raw Toggle - Markdown, SVG, JSON, YAML */}
          {(isMarkdownFile || isSvgFile || isJsonFile || isYamlFile) && !isBinaryImageFile && (
            <div className="flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-900 rounded-md h-9 p-0.5">
              <button
                onClick={() => handleViewModeChange('raw')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors ${
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
                onClick={() => handleViewModeChange('preview')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors ${
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
        ) : isBinaryImageFile ? (
          <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            {binaryPreviewUrl ? (
              <div className="w-full min-h-full flex items-center justify-center">
                <img
                  src={binaryPreviewUrl}
                  alt={selectedFile || 'image'}
                  className="max-w-full max-h-[70vh] object-contain rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
              </div>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">이미지 프리뷰를 불러오지 못했습니다.</div>
            )}
          </div>
        ) : viewMode === 'preview' && isSvgFile ? (
          <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            {svgPreviewUrl ? (
              <div className="w-full min-h-full flex items-center justify-center">
                <img
                  src={svgPreviewUrl}
                  alt={selectedFile || 'svg'}
                  className="max-w-full max-h-[70vh] object-contain rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
              </div>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">SVG 프리뷰를 불러오지 못했습니다.</div>
            )}
          </div>
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
        ) : viewMode === 'preview' && isJsonFile ? (
          /* JSON Preview - Read-only */
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <JsonYamlPreview content={editedContent} fileType="json" />
          </div>
        ) : viewMode === 'preview' && isYamlFile ? (
          /* YAML Preview - Read-only */
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <JsonYamlPreview content={editedContent} fileType="yaml" />
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