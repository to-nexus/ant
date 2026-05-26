import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EditorTab } from '@/domain/store/types';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { StreamingStatusChip } from '@/presentation/components/streaming/StreamingStatusChip';
import { splitPathForEditorHeader } from '@/shared/utils/path-utils';
import { VirtualSourceChip } from './VirtualSourceChip';
import type { EditorSource } from './FileEditorPanel/types';

const MARKDOWN_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
});

interface VirtualDocumentViewerProps {
  tab: EditorTab;
}

// Body surface intentionally has NO solid background — the file-editor slot
// wrapper in MainContentArea owns the canvas tone (var(--bg-canvas)). Painting
// a solid var(--bg-surface-2) here caused a visual fragmentation between the
// streaming view (purple solid) and the post-streaming FileEditorPanel view
// (transparent over canvas). Keep the border + radius for the document framing.
const PREVIEW_SURFACE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-1)',
  borderRadius: 'var(--r-lg)',
};

export function VirtualDocumentViewer({ tab }: VirtualDocumentViewerProps) {
  const body = tab.streamPreviewContent ?? tab.content ?? '';
  const isLikelyMarkdown = useMemo(() => {
    return !!tab.path?.toLowerCase().match(/\.(md|markdown)$/);
  }, [tab.path]);

  const virtualHeaderPathParts = useMemo(() => {
    if (tab.path) return splitPathForEditorHeader(tab.path);
    return { dirWithSlash: '', base: tab.title };
  }, [tab.path, tab.title]);

  const virtualHeaderTitle = tab.path ?? tab.title;
  const isStreaming = tab.status === 'streaming';
  // Map the live `EditorTab.source` union (`'plan' | 'design' | undefined`)
  // onto the full 4-source palette. Legacy tabs without a source fall back
  // to `'code'` so the chip slot is always filled.
  const sourceForChip: EditorSource = (tab.source as EditorSource | undefined) ?? 'code';

  return (
    <div className="w-full h-full px-3 pt-1.5 pb-3 flex flex-col relative">
      {/* Streaming shimmer banner — 2px aurora strip at the top of the panel */}
      {isStreaming && (
        <div
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--gradient-aurora-soft)',
            backgroundSize: '200% 100%',
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        className="flex min-w-0 items-center gap-3 justify-between pb-1.5"
        style={{ borderBottom: '1px solid var(--border-1)' }}
      >
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pr-1 [scrollbar-width:thin]">
          <h2
            className="inline-flex w-max max-w-none items-center whitespace-nowrap text-sm leading-snug"
            title={virtualHeaderTitle}
          >
            {virtualHeaderPathParts.dirWithSlash ? (
              <span
                className="shrink-0 font-light"
                style={{ color: 'var(--text-3)' }}
              >
                {virtualHeaderPathParts.dirWithSlash}
              </span>
            ) : null}
            <span
              className="shrink-0 font-semibold"
              style={{ color: 'var(--text-1)' }}
            >
              {virtualHeaderPathParts.base}
            </span>
          </h2>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <VirtualSourceChip source={sourceForChip} />
          <StreamingStatusChip isStreaming={isStreaming} />
        </div>
      </div>

      <div className="flex-1 min-h-0 pt-3">
        {isLikelyMarkdown ? (
          <div
            className="h-full overflow-y-auto prose prose-sm dark:prose-invert max-w-none p-4"
            style={PREVIEW_SURFACE}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {body}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="h-full overflow-auto p-4" style={PREVIEW_SURFACE}>
            <pre
              className="text-xs whitespace-pre-wrap break-words"
              style={{
                color: 'var(--text-2)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {body || ' '}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
