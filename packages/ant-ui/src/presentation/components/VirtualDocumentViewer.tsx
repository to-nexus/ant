import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EditorTab } from '@/domain/store/types';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { StreamingStatusChip } from '@/presentation/components/streaming/StreamingStatusChip';
import { splitPathForEditorHeader } from '@/shared/utils/path-utils';

const MARKDOWN_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
});

interface VirtualDocumentViewerProps {
  tab: EditorTab;
}

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

  return (
    <div className="w-full h-full bg-white dark:bg-gray-800 px-3 pt-1.5 pb-3 flex flex-col">
      <div className="flex min-w-0 items-center gap-3 justify-between border-b border-gray-200 dark:border-gray-700 pb-1.5">
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pr-1 [scrollbar-width:thin]">
          <h2
            className="inline-flex w-max max-w-none items-center whitespace-nowrap text-sm leading-snug"
            title={virtualHeaderTitle}
          >
            {virtualHeaderPathParts.dirWithSlash ? (
              <span className="shrink-0 font-light text-gray-500 dark:text-gray-400">
                {virtualHeaderPathParts.dirWithSlash}
              </span>
            ) : null}
            <span className="shrink-0 font-semibold text-gray-900 dark:text-gray-100">
              {virtualHeaderPathParts.base}
            </span>
          </h2>
        </div>
        <div className="flex flex-shrink-0 items-center">
          <StreamingStatusChip isStreaming={tab.status === 'streaming'} />
        </div>
      </div>

      <div className="flex-1 min-h-0 pt-3">
        {isLikelyMarkdown ? (
          <div className="h-full overflow-y-auto prose prose-sm dark:prose-invert max-w-none p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {body}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="h-full overflow-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">
              {body || ' '}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
