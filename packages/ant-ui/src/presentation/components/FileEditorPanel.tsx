import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { fetchFileBlob, fetchFileContent, isBinaryImageFilePath, isSvgFilePath, saveFileContent } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Eye, FileText, AlertTriangle } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { JsonYamlPreview } from './JsonYamlPreview';
import { isFigmaDataPopulated } from '@ant/shared';
import { getSmartEditConfig } from './smartEdit/config';
import { SmartEditEditor } from './smartEdit/SmartEditEditor';

// Line-numbered editor component for code-like files
interface LineNumberedEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function LineNumberedEditor({ value, onChange, disabled }: LineNumberedEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  
  // ✅ Memoize lines to prevent infinite loop
  const lines = useMemo(() => value.split('\n'), [value]);
  const lineCount = lines.length;
  
  // Measure line heights after render and on resize
  useEffect(() => {
    const measureLineHeights = () => {
      if (!measureRef.current || !editorRef.current) return;
      
      const measureDiv = measureRef.current;
      // textarea clientWidth includes padding; subtract padding to get content width
      const style = getComputedStyle(editorRef.current);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const editorContentWidth = editorRef.current.clientWidth - paddingLeft - paddingRight;
      
      // Set the measure div to same width as editor content area
      measureDiv.style.width = `${editorContentWidth}px`;
      
      const heights: number[] = [];
      lines.forEach((line, i) => {
        // Create a temp span to measure this line
        const span = document.createElement('span');
        span.style.whiteSpace = 'pre-wrap';
        span.style.overflowWrap = 'break-word';
        span.textContent = line || ' '; // Empty lines need a space to have height
        measureDiv.innerHTML = '';
        measureDiv.appendChild(span);
        heights[i] = span.offsetHeight;
      });
      
      setLineHeights(heights);
    };
    
    measureLineHeights();
    
    // Re-measure on window resize
    const resizeObserver = new ResizeObserver(measureLineHeights);
    if (editorRef.current) {
      resizeObserver.observe(editorRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, [lines]);  // ✅ Now safe: lines is memoized
  
  // Sync scroll between editor and line numbers
  const handleScroll = useCallback(() => {
    if (editorRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);
  
  // Handle textarea change — native <textarea> yields correct text without DOM quirks
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);
  
  // Calculate width for line numbers (based on max line count)
  const lineNumberWidth = Math.max(String(lineCount).length * 8 + 16, 32);
  const lineHeight = 22; // Base line height in px (text-sm with leading-[1.625] ≈ 14 * 1.625)
  
  return (
    <div 
      ref={containerRef}
      className="flex flex-1 border rounded-lg overflow-hidden bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400"
    >
      {/* Hidden measure div */}
      <div
        ref={measureRef}
        className="absolute invisible font-mono text-sm leading-[1.625] p-0"
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}
        aria-hidden="true"
      />
      
      {/* Line numbers column */}
      <div
        ref={lineNumbersRef}
        className="flex-shrink-0 overflow-hidden select-none bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700"
        style={{ width: lineNumberWidth }}
      >
        <div className="py-3 font-mono text-sm">
          {lines.map((_, i) => (
            <div
              key={i}
              className="px-2 text-right text-gray-400 dark:text-gray-500"
              style={{ height: lineHeights[i] || lineHeight }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      
      {/* Textarea editor — no contentEditable quirks, paste works natively */}
      <textarea
        ref={editorRef}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        disabled={disabled}
        className="flex-1 p-3 font-mono text-sm resize-none overflow-auto leading-[1.625] break-words
          border-0
          bg-transparent
          text-gray-900 dark:text-white
          focus:outline-none
          disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ minHeight: '100%' }}
        spellCheck={false}
        wrap="soft"
      />
    </div>
  );
}

interface FileEditorPanelProps {
  onClose?: () => void;
}

export function FileEditorPanel({ onClose: _onClose }: FileEditorPanelProps) {
  const { t } = useTranslation('artifacts');
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

  const bridgeConnected = useStore((state) => state.bridgeConnected);
  const figmaDesktopReachable = useStore((state) => state.figmaDesktopReachable);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const setAccountConfigScrollTarget = useStore((state) => state.setAccountConfigScrollTarget);
  const setFigmaPopulated = useStore((state) => state.setFigmaPopulated);

  const isFigmaFile = selectedFile?.endsWith('figma.json') ?? false;

  // ── Smart edit ────────────────────────────────────────
  const smartEditConfig = useMemo(
    () => (selectedFile ? getSmartEditConfig(selectedFile) : null),
    [selectedFile],
  );

  const deserializeResult = useMemo(
    () => (smartEditConfig ? smartEditConfig.deserialize(editedContent) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [smartEditConfig, editedContent],
  );

  const useSmartEdit = deserializeResult?.ok === true;

  // ── Header warning (single, priority-ordered) ────────
  type HeaderWarningType = 'syntax_error' | 'figma_empty' | 'figma_not_connected';

  const headerWarning = useMemo((): HeaderWarningType | null => {
    if (smartEditConfig && deserializeResult && !deserializeResult.ok) {
      return 'syntax_error';
    }
    if (isFigmaFile) {
      try {
        const parsed = JSON.parse(editedContent || '{}');
        if (!isFigmaDataPopulated(parsed)) return 'figma_empty';
      } catch {
        return null;
      }
      if (bridgeConnected !== true || !figmaDesktopReachable) {
        return 'figma_not_connected';
      }
    }
    return null;
  }, [smartEditConfig, deserializeResult, isFigmaFile, editedContent, bridgeConnected, figmaDesktopReachable]);

  // ── Reset handler (smart edit files only) ─────────────
  const handleReset = useCallback(() => {
    if (!smartEditConfig) return;
    const empty = smartEditConfig.createEmpty();
    handleContentChange(empty);
  }, [smartEditConfig]);

  const isAlreadyEmpty = useMemo(
    () => (smartEditConfig ? editedContent === smartEditConfig.createEmpty() : true),
    [smartEditConfig, editedContent],
  );

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

    // SVGs without explicit width/height fall back to the HTML replaced-element
    // default of 300x150, causing square icons to render as wide rectangles.
    // Extract dimensions from viewBox and set them explicitly.
    let svgContent = editedContent;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      if (svgEl) {
        const w = svgEl.getAttribute('width');
        const h = svgEl.getAttribute('height');
        const needsWidth = !w || w === '100%';
        const needsHeight = !h || h === '100%';
        if (needsWidth || needsHeight) {
          const viewBox = svgEl.getAttribute('viewBox');
          if (viewBox) {
            const parts = viewBox.trim().split(/[\s,]+/);
            if (parts.length === 4) {
              svgEl.setAttribute('width', parts[2]);
              svgEl.setAttribute('height', parts[3]);
              svgContent = new XMLSerializer().serializeToString(doc);
            }
          }
        }
      }
    } catch {
      // Parse failed — use original content as-is
    }

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
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
    if (isBinaryImageFile) return;
    
    try {
      setSaving(true);
      await saveFileContent(selectedProject, selectedFeature, selectedFile, editedContent);
      setFileContent(editedContent);
      setHasChanges(false);

      if (isFigmaFile) {
        try {
          const parsed = JSON.parse(editedContent);
          setFigmaPopulated(isFigmaDataPopulated(parsed));
        } catch {
          setFigmaPopulated(false);
        }
      }
    } catch (error) {
      console.error('Failed to save file:', error);
      showError(t('error.saveFailed'), { title: t('common:error.title') });
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
                    title={t('actions.openInNewTab')}
                  >
                    Open
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Header warning — single, priority-ordered */}
          {headerWarning === 'syntax_error' && (
            <div className="flex items-center gap-1.5 ml-4 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
              <span className="text-xs text-red-700 dark:text-red-300">
                {t('editor.syntaxError')}
              </span>
            </div>
          )}
          {headerWarning === 'figma_empty' && (
            <div className="flex items-center gap-1.5 ml-4 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {t('editor.figmaEmpty')}
              </span>
            </div>
          )}
          {headerWarning === 'figma_not_connected' && (
            <div className="flex items-center gap-1.5 ml-4 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {t('editor.figmaNotConnected')}
              </span>
              <button
                onClick={() => {
                  openMainPanelTab('accountConfig');
                  setAccountConfigScrollTarget('figma');
                }}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-1"
              >
                {t('editor.figmaSetup')}
              </button>
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
                title={t('editor.raw')}
              >
                <FileText className="w-3.5 h-3.5" />
                {t('editor.raw')}
              </button>
              <button
                onClick={() => handleViewModeChange('preview')}
                className={`flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
                title={t('editor.preview')}
              >
                <Eye className="w-3.5 h-3.5" />
                {t('editor.preview')}
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden pt-4">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 p-4">{t('common:status.loading')}</div>
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
              <div className="text-sm text-gray-500 dark:text-gray-400">{t('editor.svgPreviewFailed')}</div>
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
            {/* Raw Editor — smart edit or line-numbered depending on config */}
            {useSmartEdit && deserializeResult.ok ? (
              <SmartEditEditor
                content={editedContent}
                config={smartEditConfig!}
                initialResult={deserializeResult}
                onChange={handleContentChange}
              />
            ) : (
              <LineNumberedEditor
                value={editedContent}
                onChange={handleContentChange}
              />
            )}
            
            {/* Action buttons at the bottom */}
            <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              {smartEditConfig && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  disabled={loading || saving || isAlreadyEmpty}
                >
                  {t('fileEditor.reset')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={loadFileContent}
                disabled={loading || saving || !hasChanges}
              >
                {t('fileEditor.revert')}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={loading || saving || !hasChanges}
              >
                {saving ? t('fileEditor.saving') : t('fileEditor.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}