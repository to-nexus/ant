import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Undo2, FileEdit, FilePlus, FileX, FileSymlink } from 'lucide-react';
import type { FileChange } from '@ant/shared';

interface GitChangesPanelProps {
  staged: ReadonlyArray<FileChange>;
  unstaged: ReadonlyArray<FileChange>;
  untracked: ReadonlyArray<FileChange>;
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
  modified: 'var(--orange-500)',
  new: 'var(--status-done-fg, var(--teal-500))',
  deleted: 'var(--red-500)',
  renamed: 'var(--violet-500)',
};

export function GitChangesPanel({
  staged,
  unstaged,
  untracked,
  selectedFiles,
  onSelectedFilesChange,
  onDiscardFiles,
  isDiscarding,
}: GitChangesPanelProps) {
  const { t } = useTranslation('explorer');
  const [isExpanded, setIsExpanded] = useState(false);

  const allFiles: FileChange[] = [...staged, ...unstaged, ...untracked];

  const allPaths = allFiles.map(f => f.path);
  const allSelected = allPaths.length > 0 && allPaths.every(p => selectedFiles.includes(p));
  const someSelected = selectedFiles.length > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (allFiles.length === 0) return null;

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
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors"
        style={{ color: 'var(--text-3)', background: 'transparent' }}
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{t('git.changes')} ({allFiles.length})</span>
      </button>

      {isExpanded && (
        <div
          className="ml-1 pl-2 space-y-0.5 max-h-[200px] overflow-y-auto"
          style={{ borderLeft: '1px solid var(--border-1)' }}
        >
          <div className="flex items-center gap-1.5 px-1 py-0.5">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={handleToggleAll}
              className="w-3 h-3 rounded cursor-pointer"
              style={{ accentColor: 'var(--violet-500)' }}
            />
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
              {allSelected ? t('git.deselectAll') : t('git.selectAll')}
            </span>
          </div>

          {allFiles.map((file) => {
            const Icon = STATUS_ICON[file.status];
            const colorVar = STATUS_COLOR[file.status];
            const isChecked = selectedFiles.includes(file.path);
            const fileName = file.path.split('/').pop() || file.path;
            const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

            return (
              <div
                key={file.path}
                className="group flex items-center gap-1.5 px-1 py-0.5 rounded transition-colors"
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleFile(file.path)}
                  className="w-3 h-3 rounded cursor-pointer flex-shrink-0"
                  style={{ accentColor: 'var(--violet-500)' }}
                />
                <Icon className="w-3 h-3 flex-shrink-0" style={{ color: colorVar }} />
                <span
                  className="text-[11px] truncate flex-1 min-w-0"
                  style={{ color: 'var(--text-2)' }}
                  title={file.path}
                >
                  {dirPath && <span style={{ color: 'var(--text-3)' }}>{dirPath}/</span>}
                  {fileName}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardFiles([file.path]);
                  }}
                  disabled={isDiscarding}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity"
                  style={{ background: 'transparent' }}
                  title={t('git.discardFile')}
                >
                  <Undo2 className="w-3 h-3" style={{ color: 'var(--red-500)' }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
