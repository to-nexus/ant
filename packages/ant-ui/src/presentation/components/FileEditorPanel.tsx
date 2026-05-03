import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { fetchFileBlob, isBinaryImageFilePath, isHtmlFilePath, isSvgFilePath } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Eye, FileText, AlertTriangle } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
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

  const lines = useMemo(() => value.split('\n'), [value]);
  const lineCount = lines.length;

  useEffect(() => {
    const measureLineHeights = () => {
      if (!measureRef.current || !editorRef.current) return;

      const measureDiv = measureRef.current;
      const style = getComputedStyle(editorRef.current);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const editorContentWidth = editorRef.current.clientWidth - paddingLeft - paddingRight;

      measureDiv.style.width = `${editorContentWidth}px`;

      const heights: number[] = [];
      lines.forEach((line, i) => {
        const span = document.createElement('span');
        span.style.whiteSpace = 'pre-wrap';
        span.style.overflowWrap = 'break-word';
        span.textContent = line || ' ';
        measureDiv.innerHTML = '';
        measureDiv.appendChild(span);
        heights[i] = span.offsetHeight;
      });

      setLineHeights(heights);
    };

    measureLineHeights();

    const resizeObserver = new ResizeObserver(measureLineHeights);
    if (editorRef.current) {
      resizeObserver.observe(editorRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [lines]);

  const handleScroll = useCallback(() => {
    if (editorRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  const lineNumberWidth = Math.max(String(lineCount).length * 8 + 16, 32);
  const lineHeight = 22;

  return (
    <div 
      ref={containerRef}
      className="flex flex-1 border rounded-lg overflow-hidden bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400"
    >
      <div
        ref={measureRef}
        className="absolute invisible font-mono text-sm leading-[1.625] p-0"
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}
        aria-hidden="true"
      />

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

const MARKDOWN_PREVIEW_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
});

/**
 * FileEditorPanel
 *
 * The editor's single source of truth for the displayed file is the
 * `currentFile: AsyncFields<FileResource>` slice in `fileSlice`. This
 * component subscribes to that slice for content, meta (template warning),
 * dirty buffer and save status — it never holds the remote body in local
 * state. See docs/architecture/ui-async-policy.md "Remote Resource
 * Single-SSOT".
 */
export function FileEditorPanel({ onClose: _onClose }: FileEditorPanelProps) {
  const { t } = useTranslation('artifacts');
  const { showError } = useAlertModalContext();
  const policy = useUIActionPolicy();
  const notifyArtifactMutationBlocked = useNotifyArtifactMutationBlocked();
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const lastViewMode = useStore((state) => state.lastViewMode);
  const setLastViewMode = useStore((state) => state.setLastViewMode);

  // FileResource slice — the single SSOT for the file being edited.
  const fileStatus = useStore((s) => s.currentFile.status);
  const fileData = useStore((s) => s.currentFile.data);
  const fileBuffer = useStore((s) => s.currentFile.buffer);
  const savingStatus = useStore((s) => s.currentFile.savingStatus);
  const openFile = useStore((s) => s.openFile);
  const updateBuffer = useStore((s) => s.updateBuffer);
  const saveCurrentFile = useStore((s) => s.saveCurrentFile);
  const discardBuffer = useStore((s) => s.discardBuffer);

  const bridgeConnected = useStore((state) => state.bridgeConnected);
  const figmaDesktopReachable = useStore((state) => state.figmaDesktopReachable);
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);
  const setAccountConfigScrollTarget = useStore((state) => state.setAccountConfigScrollTarget);

  const [viewMode, setViewMode] = useState<'raw' | 'preview'>('raw');
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null);
  const [svgPreviewUrl, setSvgPreviewUrl] = useState<string | null>(null);
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState<string | null>(null);

  const isFigmaFile = selectedFile?.endsWith('figma.json') ?? false;
  const isBinaryImageFile = isBinaryImageFilePath(selectedFile);

  // Derived editor content: buffer when dirty, else the server ground truth.
  // Binary files don't use this path (they have no text content).
  const editedContent = fileBuffer ?? fileData?.content ?? '';
  const hasChanges = fileBuffer !== null;
  const saving = savingStatus === 'saving';
  const loading = fileStatus === 'loading';

  // Re-open / fetch when the selected path changes. The slice itself guards
  // against stale responses if the user moves on mid-flight.
  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (isBinaryImageFile) return; // binary files load via blob below
    openFile(selectedFile);
  }, [selectedProject, selectedFeature, selectedFile, isBinaryImageFile, openFile]);

  // Binary image preview — loaded via blob, independent of FileResource text
  // content. Still subscribes to path changes.
  useEffect(() => {
    let cancelled = false;

    const cleanupBlob = () => {
      setBinaryPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };

    if (!isBinaryImageFile || !selectedProject || !selectedFeature || !selectedFile) {
      cleanupBlob();
      return;
    }

    cleanupBlob();
    (async () => {
      try {
        const blob = await fetchFileBlob(selectedProject, selectedFeature, selectedFile);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBinaryPreviewUrl(url);
      } catch (err) {
        if (!cancelled) console.error('Failed to load image:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [isBinaryImageFile, selectedProject, selectedFeature, selectedFile]);

  // Cleanup blob URLs on unmount.
  useEffect(() => () => {
    if (binaryPreviewUrl) URL.revokeObjectURL(binaryPreviewUrl);
    if (svgPreviewUrl) URL.revokeObjectURL(svgPreviewUrl);
    if (htmlPreviewUrl) URL.revokeObjectURL(htmlPreviewUrl);
  }, [binaryPreviewUrl, svgPreviewUrl, htmlPreviewUrl]);

  const isSvgFile = isSvgFilePath(selectedFile);
  const isHtmlFile = isHtmlFilePath(selectedFile);
  const isMarkdownFile = selectedFile?.toLowerCase().match(/\.(md|markdown)$/);
  const isJsonFile = selectedFile?.toLowerCase().match(/\.json$/);
  const isJsonlFile = selectedFile?.toLowerCase().match(/\.jsonl$/);
  const isYamlFile = selectedFile?.toLowerCase().match(/\.(yaml|yml)$/);
  const hasMultipleModes =
    (isMarkdownFile || isSvgFile || isHtmlFile || isJsonFile || isJsonlFile || isYamlFile) && !isBinaryImageFile;

  useEffect(() => {
    if (hasMultipleModes) {
      setViewMode(lastViewMode);
    } else {
      setViewMode('raw');
    }
  }, [selectedFile, hasMultipleModes, lastViewMode]);

  // Build/refresh SVG preview URL from edited content (preview mode only)
  useEffect(() => {
    if (!isSvgFile) return;
    if (viewMode !== 'preview') return;
    if (!editedContent) return;

    if (svgPreviewUrl) {
      URL.revokeObjectURL(svgPreviewUrl);
      setSvgPreviewUrl(null);
    }

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
      // parse failed — use as-is
    }

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    setSvgPreviewUrl(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSvgFile, viewMode, editedContent]);

  // HTML preview — blob document in sandboxed iframe (scripts disabled by default)
  useEffect(() => {
    if (!isHtmlFile) {
      setHtmlPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    if (viewMode !== 'preview') {
      setHtmlPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    setHtmlPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      const blob = new Blob([editedContent], { type: 'text/html;charset=utf-8' });
      return URL.createObjectURL(blob);
    });
  }, [isHtmlFile, viewMode, editedContent]);

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
  type HeaderWarningType = 'syntax_error' | 'figma_empty' | 'figma_not_connected' | 'template_marker' | 'template_empty';

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
    // Template state: always sourced from the FileResource meta (the server
    // recomputes it on every write and returns it in the mutation response,
    // so this reflects the last saved state with no SSE dependency).
    const meta = fileData?.meta;
    if (meta?.isTemplate) {
      if (meta.templateReason === 'file_empty') return 'template_empty';
      return 'template_marker';
    }
    return null;
  }, [smartEditConfig, deserializeResult, isFigmaFile, editedContent, bridgeConnected, figmaDesktopReachable, fileData]);

  const handleContentChange = useCallback((newContent: string) => {
    updateBuffer(newContent);
  }, [updateBuffer]);

  const handleReset = useCallback(() => {
    if (!smartEditConfig) return;
    const empty = smartEditConfig.createEmpty();
    handleContentChange(empty);
  }, [smartEditConfig, handleContentChange]);

  const isAlreadyEmpty = useMemo(
    () => (smartEditConfig ? editedContent === smartEditConfig.createEmpty() : true),
    [smartEditConfig, editedContent],
  );

  const handleSave = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (isBinaryImageFile) return;
    if (notifyArtifactMutationBlocked()) return;
    try {
      await saveCurrentFile();
    } catch (error) {
      console.error('Failed to save file:', error);
      showError(t('error.saveFailed'), { title: t('common:error.title') });
    }
  }, [selectedProject, selectedFeature, selectedFile, isBinaryImageFile, notifyArtifactMutationBlocked, saveCurrentFile, showError, t]);

  const handleRevert = useCallback(() => {
    discardBuffer();
  }, [discardBuffer]);

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
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate" title={selectedFile}>
              {selectedFile}
            </div>
            {hasChanges && (
              <div className="text-xs text-orange-500 mt-0.5">● Modified</div>
            )}
          </div>

          {isBinaryImageFile && (
            <div className="flex items-center gap-2 ml-4">
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
          {headerWarning === 'template_marker' && (
            <div className="flex items-center gap-1.5 ml-4 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {t('editor.templateMarker', {
                  contentLength: fileData?.meta.templateContentLength ?? 0,
                  threshold: fileData?.meta.templateThreshold ?? 50,
                })}
              </span>
            </div>
          )}
          {headerWarning === 'template_empty' && (
            <div className="flex items-center gap-1.5 ml-4 px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                {t('editor.templateEmpty')}
              </span>
            </div>
          )}

          {(isMarkdownFile || isSvgFile || isHtmlFile || isJsonFile || isJsonlFile || isYamlFile) &&
            !isBinaryImageFile && (
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
          <div className="flex-1 overflow-y-auto prose prose-sm dark:prose-invert max-w-none p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MARKDOWN_PREVIEW_COMPONENTS}
            >
              {editedContent}
            </ReactMarkdown>
          </div>
        ) : viewMode === 'preview' && isJsonFile ? (
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <JsonYamlPreview content={editedContent} fileType="json" />
          </div>
        ) : viewMode === 'preview' && isJsonlFile ? (
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <JsonYamlPreview content={editedContent} fileType="jsonl" />
          </div>
        ) : viewMode === 'preview' && isYamlFile ? (
          <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <JsonYamlPreview content={editedContent} fileType="yaml" />
          </div>
        ) : viewMode === 'preview' && isHtmlFile ? (
          <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {htmlPreviewUrl ? (
              <iframe
                title={selectedFile || 'html-preview'}
                src={htmlPreviewUrl}
                sandbox=""
                className="h-full min-h-[70vh] w-full border-0 bg-white"
              />
            ) : (
              <div className="p-4 text-sm text-gray-500 dark:text-gray-400">{t('editor.htmlPreviewFailed')}</div>
            )}
          </div>
        ) : (
          <>
            {useSmartEdit && deserializeResult.ok ? (
              <SmartEditEditor
                content={editedContent}
                config={smartEditConfig!}
                initialResult={deserializeResult}
                onChange={handleContentChange}
                disabled={!policy.canCreateFile}
              />
            ) : (
              <LineNumberedEditor
                value={editedContent}
                onChange={handleContentChange}
                disabled={!policy.canCreateFile}
              />
            )}

            <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
              {smartEditConfig && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReset}
                  disabled={loading || saving || isAlreadyEmpty || !policy.canCreateFile}
                >
                  {t('fileEditor.reset')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleRevert}
                disabled={loading || saving || !hasChanges}
              >
                {t('fileEditor.revert')}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={loading || saving || !hasChanges || !policy.canCreateFile}
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
