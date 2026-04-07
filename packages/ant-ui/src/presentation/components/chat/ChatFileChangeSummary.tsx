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
        className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors w-full"
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
            <span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] font-medium">
              +{fileStats.filesCreated}
            </span>
          )}
          {fileStats.filesEdited > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
              ~{fileStats.filesEdited}
            </span>
          )}
          {fileStats.filesDeleted > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[10px] font-medium">
              -{fileStats.filesDeleted}
            </span>
          )}
        </div>
      </button>

      {showFileList && fileStats.files && fileStats.files.length > 0 && (
        <div className="mt-2 ml-5 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
          {fileStats.files.map((file, idx) => {
            const operationColor =
              file.operation === 'create' ? 'text-green-600 dark:text-green-400' :
              file.operation === 'edit' ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400';

            const operationLabel =
              file.operation === 'create' ? 'Created' :
              file.operation === 'edit' ? 'Modified' :
              'Deleted';

            return (
              <div key={idx} className="flex items-center gap-2 py-0.5">
                <span className={`font-medium ${operationColor} w-16`}>
                  {operationLabel}
                </span>
                <span className={`font-mono truncate flex-1 ${operationColor}`}>
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
