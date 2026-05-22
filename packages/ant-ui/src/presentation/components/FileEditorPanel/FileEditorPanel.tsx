
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  fetchFileBlob,
  isBinaryImageFilePath,
  isHtmlFilePath,
  isSvgFilePath,
} from '@/infrastructure/http/api';
import {
  canToggleViewMode,
  DEFAULT_VIEW_MODE,
  resolveViewMode,
  type ViewMode,
} from '@/domain/file/viewMode';
import { Button } from '@/presentation/components/aurora';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Eye, FileText, AlertTriangle } from 'lucide-react';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useNotifyArtifactMutationBlocked } from '@/application/hooks/ui/useNotifyArtifactMutationBlocked';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { JsonYamlPreview } from '../JsonYamlPreview';
import { isFigmaDataPopulated } from '@ant/shared';
import { splitPathForEditorHeader } from '@/shared/utils/path-utils';
import { getSmartEditConfig } from '../smartEdit/config';
import { SmartEditEditor } from '../smartEdit/SmartEditEditor';
import { selectActiveEditorTab } from '@/domain/store/selectors/editorTabs';
import { StreamingStatusChip } from '@/presentation/components/streaming/StreamingStatusChip';
import { LineNumberedEditor } from './LineNumberedEditor';
import { EditorLangChip } from './EditorLangChip';

interface FileEditorPanelProps {
  onClose?: () => void;
}

const MARKDOWN_PREVIEW_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
});

// ── Warning chip surface tokens ─────────────────────────────────────
const WARN_AMBER: React.CSSProperties = {
  background: 'oklch(96% 0.04 85)',
  borderColor: 'oklch(86% 0.10 85)',
  color: 'oklch(40% 0.12 60)',
};
const WARN_ERROR: React.CSSProperties = {
  background: 'var(--status-error-bg)',
  borderColor: 'var(--status-error-fg)',
  color: 'var(--status-error-fg)',
};

interface HeaderWarningProps {
  variant: 'amber' | 'error';
  label: string;
  iconColor: string;
  actionLabel?: string;
  onAction?: () => void;
}

function HeaderWarningChip({
  variant,
  label,
  iconColor,
  actionLabel,
  onAction,
}: HeaderWarningProps) {
  const surface = variant === 'error' ? WARN_ERROR : WARN_AMBER;
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5"
      style={{
        background: surface.background,
        border: `1px solid ${surface.borderColor}`,
        borderRadius: 'var(--r-md)',
      }}
    >
      <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: iconColor }} />
      <span className="text-[11px]" style={{ color: surface.color }}>
        {label}
      </span>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="text-[11px] font-medium hover:underline flex-shrink-0 ml-0.5"
          style={{ color: 'var(--violet-600)' }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * FileEditorPanel — Aurora-skinned editor shell.
 *
 * The editor's single source of truth for the displayed file is the
 * `currentFile: AsyncFields<FileResource>` slice in `fileSlice`. This
 * component subscribes to that slice for content, meta (template warning),
 * dirty buffer and save status — it never holds the remote body in local
 * state. See docs/architecture/ui-async-policy.md "Remote Resource
 * Single-SSOT".
 *
 * EXECUTION-CONTEXT: browser-runtime (DOMParser, XMLSerializer, Blob,
 * URL.createObjectURL).
 */
export function FileEditorPanel({ onClose: _onClose }: FileEditorPanelProps) {
  const { t } = useTranslation('artifacts');
  const { showError } = useAlertModalContext();
  const policy = useUIActionPolicy();
  const notifyArtifactMutationBlocked = useNotifyArtifactMutationBlocked();
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const mainPanelActiveTab = useStore((state) => state.mainPanelActiveTab);
  const editorTabs = useStore((state) => state.editorTabs);
  const activeEditorTabId = useStore((state) => state.activeEditorTabId);
  const viewModeByPath = useStore((state) => state.viewModeByPath);
  const setFileViewMode = useStore((state) => state.setFileViewMode);

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

  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null);
  const [svgPreviewUrl, setSvgPreviewUrl] = useState<string | null>(null);
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState<string | null>(null);

  const activeEditorTab = useMemo(
    () =>
      selectActiveEditorTab({
        mainPanelActiveTab,
        activeEditorTabId,
        editorTabs,
      }),
    [activeEditorTabId, editorTabs, mainPanelActiveTab],
  );
  const isStreamingPreviewTab =
    activeEditorTab?.status === 'streaming' &&
    (activeEditorTab.source === 'design' || activeEditorTab.source === 'plan');

  const isFigmaFile = selectedFile?.endsWith('figma.json') ?? false;
  const isBinaryImageFile = isBinaryImageFilePath(selectedFile);

  // Derived editor content: buffer when dirty, else the server ground truth.
  const editedContent = fileBuffer ?? fileData?.content ?? '';
  const hasChanges = fileBuffer !== null;
  const saving = savingStatus === 'saving';
  const loading = fileStatus === 'loading';

  // Re-open / fetch when the selected path changes.
  useEffect(() => {
    if (!selectedProject || !selectedFeature || !selectedFile) return;
    if (isBinaryImageFile) return;
    openFile(selectedFile);
  }, [selectedProject, selectedFeature, selectedFile, isBinaryImageFile, openFile]);

  // Binary image preview via blob.
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
    return () => {
      cancelled = true;
    };
  }, [isBinaryImageFile, selectedProject, selectedFeature, selectedFile]);

  // Cleanup blob URLs on unmount.
  useEffect(
    () => () => {
      if (binaryPreviewUrl) URL.revokeObjectURL(binaryPreviewUrl);
      if (svgPreviewUrl) URL.revokeObjectURL(svgPreviewUrl);
      if (htmlPreviewUrl) URL.revokeObjectURL(htmlPreviewUrl);
    },
    [binaryPreviewUrl, svgPreviewUrl, htmlPreviewUrl],
  );

  const isSvgFile = isSvgFilePath(selectedFile);
  const isHtmlFile = isHtmlFilePath(selectedFile);
  const lowerSelectedFile = selectedFile?.toLowerCase() ?? '';
  const isMarkdownFile = /\.(md|markdown)$/.test(lowerSelectedFile);
  const isJsonFile = /\.json$/.test(lowerSelectedFile);
  const isJsonlFile = /\.jsonl$/.test(lowerSelectedFile);
  const isYamlFile = /\.(yaml|yml)$/.test(lowerSelectedFile);
  const showViewModeToggle = canToggleViewMode(selectedFile) && !isStreamingPreviewTab;

  const editorHeaderPathParts = useMemo(
    () => (selectedFile ? splitPathForEditorHeader(selectedFile) : null),
    [selectedFile],
  );

  useEffect(() => {
    setViewMode(resolveViewMode(selectedFile, viewModeByPath));
  }, [selectedFile, viewModeByPath]);

  // SVG preview URL.
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

  // HTML preview — blob document in sandboxed iframe.
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

  // ── Smart edit ───────────────────────────────────────
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
  type HeaderWarningType =
    | 'syntax_error'
    | 'figma_empty'
    | 'figma_not_connected'
    | 'template_marker'
    | 'template_empty';

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
    const meta = fileData?.meta;
    if (meta?.isTemplate) {
      if (meta.templateReason === 'file_empty') return 'template_empty';
      return 'template_marker';
    }
    return null;
  }, [
    smartEditConfig,
    deserializeResult,
    isFigmaFile,
    editedContent,
    bridgeConnected,
    figmaDesktopReachable,
    fileData,
  ]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      updateBuffer(newContent);
    },
    [updateBuffer],
  );

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
  }, [
    selectedProject,
    selectedFeature,
    selectedFile,
    isBinaryImageFile,
    notifyArtifactMutationBlocked,
    saveCurrentFile,
    showError,
    t,
  ]);

  const handleRevert = useCallback(() => {
    discardBuffer();
  }, [discardBuffer]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (!selectedFile) return;
    setFileViewMode(selectedFile, mode);
  };

  // ── View toggle pill (Aurora) ───────────────────────
  const renderViewToggle = () => {
    if (!showViewModeToggle) return null;
    const pillBtn = (active: boolean): React.CSSProperties => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 20,
      padding: '0 8px',
      fontSize: 11,
      fontWeight: 600,
      borderRadius: 'var(--r-sm)',
      background: active ? 'var(--bg-canvas)' : 'transparent',
      color: active ? 'var(--text-1)' : 'var(--text-3)',
      border: 'none',
      cursor: 'pointer',
      boxShadow: active ? 'var(--shadow-xs)' : 'none',
      transition: 'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)',
    });
    return (
      <div
        className="flex items-center gap-0.5 h-6"
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-md)',
          padding: 2,
        }}
      >
        <button
          onClick={() => handleViewModeChange('raw')}
          style={pillBtn(viewMode === 'raw')}
          title={t('editor.raw')}
        >
          <FileText className="w-3 h-3" />
          {t('editor.raw')}
        </button>
        <button
          onClick={() => handleViewModeChange('preview')}
          style={pillBtn(viewMode === 'preview')}
          title={t('editor.preview')}
        >
          <Eye className="w-3 h-3" />
          {t('editor.preview')}
        </button>
      </div>
    );
  };

  const previewSurface: React.CSSProperties = {
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border-1)',
    borderRadius: 'var(--r-lg)',
  };

  return (
    <div
      className="w-full px-3 pt-1.5 pb-3 flex flex-col h-full"
      style={{ background: 'var(--bg-canvas)' }}
    >
      {/* Header */}
      <div
        className="pb-1.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-1)' }}
      >
        <div className="flex min-w-0 items-center gap-3 justify-between">
          {editorHeaderPathParts ? (
            <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pr-1 [scrollbar-width:thin] flex items-center gap-2">
              <h2
                className="inline-flex w-max max-w-none items-center whitespace-nowrap text-sm leading-snug"
                title={selectedFile ?? undefined}
              >
                {editorHeaderPathParts.dirWithSlash ? (
                  <span
                    className="shrink-0 font-light"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {editorHeaderPathParts.dirWithSlash}
                  </span>
                ) : null}
                <span
                  className="shrink-0 font-semibold"
                  style={{ color: 'var(--text-1)' }}
                >
                  {editorHeaderPathParts.base}
                </span>
              </h2>
              <EditorLangChip filePath={selectedFile ?? null} />
            </div>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
            {isStreamingPreviewTab && <StreamingStatusChip isStreaming={true} />}
            {hasChanges && (
              <span
                className="text-[10px] leading-none"
                style={{ color: 'var(--amber-500)' }}
              >
                ● Modified
              </span>
            )}

            {isBinaryImageFile && binaryPreviewUrl && (
              <a
                href={binaryPreviewUrl}
                target="_blank"
                rel="noreferrer"
                title={t('actions.openInNewTab')}
                className="inline-flex items-center justify-center h-6 px-2 text-[11px] transition-colors"
                style={{
                  color: 'var(--text-2)',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-1)',
                  background: 'var(--bg-surface-2)',
                }}
              >
                Open
              </a>
            )}

            {headerWarning === 'syntax_error' && (
              <HeaderWarningChip
                variant="error"
                label={t('editor.syntaxError')}
                iconColor="var(--status-error-fg)"
              />
            )}
            {headerWarning === 'figma_empty' && (
              <HeaderWarningChip
                variant="amber"
                label={t('editor.figmaEmpty')}
                iconColor="var(--amber-500)"
              />
            )}
            {headerWarning === 'figma_not_connected' && (
              <HeaderWarningChip
                variant="amber"
                label={t('editor.figmaNotConnected')}
                iconColor="var(--amber-500)"
                actionLabel={t('editor.figmaSetup')}
                onAction={() => {
                  openMainPanelTab('accountConfig');
                  setAccountConfigScrollTarget('figma');
                }}
              />
            )}
            {headerWarning === 'template_marker' && (
              <HeaderWarningChip
                variant="amber"
                label={t('editor.templateMarker', {
                  contentLength: fileData?.meta.templateContentLength ?? 0,
                  threshold: fileData?.meta.templateThreshold ?? 50,
                })}
                iconColor="var(--amber-500)"
              />
            )}
            {headerWarning === 'template_empty' && (
              <HeaderWarningChip
                variant="amber"
                label={t('editor.templateEmpty')}
                iconColor="var(--amber-500)"
              />
            )}

            {renderViewToggle()}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden pt-3">
        {loading ? (
          <div
            className="text-sm p-4"
            style={{ color: 'var(--text-3)' }}
          >
            {t('common:status.loading')}
          </div>
        ) : isBinaryImageFile ? (
          <div className="flex-1 overflow-auto p-4" style={previewSurface}>
            {binaryPreviewUrl ? (
              <div className="w-full min-h-full flex items-center justify-center">
                <img
                  src={binaryPreviewUrl}
                  alt={selectedFile || 'image'}
                  className="max-w-full max-h-[70vh] object-contain"
                  style={{
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border-1)',
                    background: 'var(--bg-canvas)',
                  }}
                />
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                이미지 프리뷰를 불러오지 못했습니다.
              </div>
            )}
          </div>
        ) : viewMode === 'preview' && isSvgFile ? (
          <div className="flex-1 overflow-auto p-4" style={previewSurface}>
            {svgPreviewUrl ? (
              <div className="w-full min-h-full flex items-center justify-center">
                <img
                  src={svgPreviewUrl}
                  alt={selectedFile || 'svg'}
                  className="max-w-full max-h-[70vh] object-contain"
                  style={{
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border-1)',
                    background: 'var(--bg-canvas)',
                  }}
                />
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                {t('editor.svgPreviewFailed')}
              </div>
            )}
          </div>
        ) : viewMode === 'preview' && isMarkdownFile ? (
          <div
            className="flex-1 overflow-y-auto prose prose-sm max-w-none p-4"
            style={previewSurface}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={MARKDOWN_PREVIEW_COMPONENTS}
            >
              {editedContent}
            </ReactMarkdown>
          </div>
        ) : viewMode === 'preview' && isJsonFile ? (
          <div className="flex-1 overflow-y-auto" style={previewSurface}>
            <JsonYamlPreview content={editedContent} fileType="json" />
          </div>
        ) : viewMode === 'preview' && isJsonlFile ? (
          <div className="flex-1 overflow-y-auto" style={previewSurface}>
            <JsonYamlPreview content={editedContent} fileType="jsonl" />
          </div>
        ) : viewMode === 'preview' && isYamlFile ? (
          <div className="flex-1 overflow-y-auto" style={previewSurface}>
            <JsonYamlPreview content={editedContent} fileType="yaml" />
          </div>
        ) : viewMode === 'preview' && isHtmlFile ? (
          <div
            className="flex-1 min-h-0 overflow-hidden"
            style={previewSurface}
          >
            {htmlPreviewUrl ? (
              <iframe
                title={selectedFile || 'html-preview'}
                src={htmlPreviewUrl}
                sandbox=""
                className="h-full min-h-[70vh] w-full"
                style={{ border: 'none', background: 'var(--bg-canvas)' }}
              />
            ) : (
              <div
                className="p-4 text-sm"
                style={{ color: 'var(--text-3)' }}
              >
                {t('editor.htmlPreviewFailed')}
              </div>
            )}
          </div>
        ) : viewMode === 'preview' ? (
          <div className="flex-1 overflow-auto p-4" style={previewSurface}>
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap break-words"
              style={{
                color: 'var(--text-2)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {editedContent}
            </pre>
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

            <div
              className="flex gap-2 justify-end mt-3 pt-3 flex-shrink-0"
              style={{ borderTop: '1px solid var(--border-1)' }}
            >
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
