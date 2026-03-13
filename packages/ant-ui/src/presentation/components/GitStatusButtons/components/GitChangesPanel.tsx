import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Undo2, FileEdit, FilePlus, FileX, FileSymlink } from 'lucide-react';
import { FileChange, GitChanges } from '../hooks/useGitChanges';

interface GitChangesPanelProps {
  gitChanges: GitChanges;
  selectedFiles: string[];
  onSelectedFilesChange: (files: string[]) => void;
  onDiscardFiles: (files: string[]) => void;
  isDiscarding: boolean;
}

const STATUS_ICON: Record<FileChange['status'], typeof FileEdit> = {
  modified: FileEdit,
  new: FilePlus,
  deleted: FileX,
  renamed: FileSymlink,
};

const STATUS_COLOR: Record<FileChange['status'], string> = {
  modified: 'text-yellow-500 dark:text-yellow-400',
  new: 'text-green-500 dark:text-green-400',
  deleted: 'text-red-500 dark:text-red-400',
  renamed: 'text-blue-500 dark:text-blue-400',
};

export function GitChangesPanel({
  gitChanges,
  selectedFiles,
  onSelectedFilesChange,
  onDiscardFiles,
  isDiscarding
}: GitChangesPanelProps) {
  const { t } = useTranslation('explorer');
  const [isExpanded, setIsExpanded] = useState(false);

  const allFiles: FileChange[] = [
    ...gitChanges.staged,
    ...gitChanges.unstaged,
    ...gitChanges.untracked,
  ];

  if (allFiles.length === 0) return null;

  const allPaths = allFiles.map(f => f.path);
  const allSelected = allPaths.every(p => selectedFiles.includes(p));

  const handleToggleAll = () => {
    if (allSelected) {
      onSelectedFilesChange([]);
    } else {
      onSelectedFilesChange([...allPaths]);
    }
  };

  const handleToggleFile = (filePath: string) => {
    if (selectedFiles.includes(filePath)) {
      onSelectedFilesChange(selectedFiles.filter(f => f !== filePath));
    } else {
      onSelectedFilesChange([...selectedFiles, filePath]);
    }
  };

  return (
    <div className="mt-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{t('git.changes')} ({allFiles.length})</span>
      </button>

      {isExpanded && (
        <div className="ml-1 border-l border-gray-200 dark:border-gray-700 pl-2 space-y-0.5 max-h-[200px] overflow-y-auto">
          {/* Select All / Deselect All */}
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={handleToggleAll}
              className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 cursor-pointer accent-emerald-500"
            />
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {allSelected ? t('git.deselectAll') : t('git.selectAll')}
            </span>
          </div>

          {allFiles.map((file) => {
            const Icon = STATUS_ICON[file.status];
            const colorClass = STATUS_COLOR[file.status];
            const isChecked = selectedFiles.includes(file.path);
            const fileName = file.path.split('/').pop() || file.path;
            const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

            return (
              <div
                key={file.path}
                className="group flex items-center gap-1.5 px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleFile(file.path)}
                  className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 cursor-pointer accent-emerald-500 flex-shrink-0"
                />
                <Icon className={`w-3 h-3 flex-shrink-0 ${colorClass}`} />
                <span className="text-[11px] text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0" title={file.path}>
                  {dirPath && <span className="text-gray-400 dark:text-gray-500">{dirPath}/</span>}
                  {fileName}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardFiles([file.path]);
                  }}
                  disabled={isDiscarding}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                  title={t('git.discardFile')}
                >
                  <Undo2 className="w-3 h-3 text-red-500 dark:text-red-400" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
