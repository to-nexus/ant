import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileStats } from '@/domain/models/chat';

interface ChatFileChangeSummaryProps {
  fileStats: FileStats;
}

/**
 * Collapsible file-change summary shown above the chat input.
 * Displays created/edited/deleted counts with color-coded badges
 * and an expandable per-file list.
 */
export function ChatFileChangeSummary({ fileStats }: ChatFileChangeSummaryProps) {
  const { t } = useTranslation('chat');
  const [showFileList, setShowFileList] = useState(false);

  const totalChangedFiles = fileStats.totalFiles ??
    ((fileStats.filesCreated || 0) + (fileStats.filesEdited || 0) + (fileStats.filesDeleted || 0));

  return (
    <div className="mb-2">
      <button
        onClick={() => setShowFileList(!showFileList)}
        className="flex items-center gap-2 text-xs transition-colors w-full"
        style={{ color: 'var(--text-2)' }}
      >
        {showFileList ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}

        <span className="font-medium">
          {t('input.filesEdited', { count: totalChangedFiles })}
        </span>

        <div className="flex items-center gap-1.5 ml-1">
          {fileStats.filesCreated > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: 'var(--status-done-bg)', color: 'var(--status-done-fg)' }}
            >
              +{fileStats.filesCreated}
            </span>
          )}
          {fileStats.filesEdited > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: 'var(--status-progress-bg)', color: 'var(--status-progress-fg)' }}
            >
              ~{fileStats.filesEdited}
            </span>
          )}
          {fileStats.filesDeleted > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-fg)' }}
            >
              -{fileStats.filesDeleted}
            </span>
          )}
        </div>
      </button>

      {showFileList && fileStats.files && fileStats.files.length > 0 && (
        <div className="mt-2 ml-5 space-y-1 text-[11px]" style={{ color: 'var(--text-2)' }}>
          {fileStats.files.map((file, idx) => {
            const operationColor =
              file.operation === 'create' ? 'var(--status-done-fg)' :
              file.operation === 'edit' ? 'var(--status-progress-fg)' :
              'var(--status-error-fg)';

            const operationLabel =
              file.operation === 'create' ? 'Created' :
              file.operation === 'edit' ? 'Modified' :
              'Deleted';

            return (
              <div key={idx} className="flex items-center gap-2 py-0.5">
                <span className="font-medium w-16" style={{ color: operationColor }}>
                  {operationLabel}
                </span>
                <span className="font-mono truncate flex-1" style={{ color: operationColor }}>
                  {file.path}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
