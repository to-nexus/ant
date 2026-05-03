import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EditorTab } from '@/domain/store/types';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { StreamingStatusChip } from '@/presentation/components/streaming/StreamingStatusChip';

const MARKDOWN_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
});

interface VirtualDocumentViewerProps {
  tab: EditorTab;
}

export function VirtualDocumentViewer({ tab }: VirtualDocumentViewerProps) {
  const body = tab.content ?? '';
  const isLikelyMarkdown = useMemo(() => {
    return !!tab.path?.toLowerCase().match(/\.(md|markdown)$/);
  }, [tab.path]);

  return (
    <div className="w-full h-full bg-white dark:bg-gray-800 p-4 flex flex-col">
      <div className="pb-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-800 dark:text-gray-100 truncate">{tab.title}</div>
          {tab.path && (
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{tab.path}</div>
          )}
        </div>
        <StreamingStatusChip isStreaming={tab.status === 'streaming'} />
      </div>

      <div className="flex-1 min-h-0 pt-4">
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
