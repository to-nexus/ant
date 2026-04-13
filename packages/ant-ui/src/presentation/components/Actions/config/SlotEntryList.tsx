import { useTranslation } from 'react-i18next';
import { Plus, Upload, FolderOpen } from 'lucide-react';
import { getFileDescription, getDirDescription } from '@ant/shared';
import { FileCard } from './FileCard';
import type { SlotEntry } from './types';

interface SlotEntryListProps {
  entries: SlotEntry[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onHighlightDir: (dir: string) => void;
  onCreateIntent: (intentId: string) => void;
  onUploadDir?: (dir: string) => void;
  onToggleSpotlight: (type: 'file' | 'dir', path: string) => void;
  onViewFile?: (path: string) => void;
  spotlightPath?: string | null;
  showEmptyActions?: boolean;
  lang: 'en' | 'ko';
}

export function SlotEntryList({ entries, selected, onToggle, onHighlightDir, onCreateIntent, onUploadDir, onToggleSpotlight, onViewFile, spotlightPath, showEmptyActions = true, lang }: SlotEntryListProps) {
  const { t } = useTranslation('actions');
  const showSlotLabels = entries.length > 1;

  return (
    <div className="space-y-1.5">
      {entries.map(entry => {
        const slotLabel = showSlotLabels ? (
          <div key={`label-${entry.def.path || entry.def.label.en}`} className="flex items-center gap-1.5 pt-1.5 first:pt-0">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || entry.def.label[lang] || entry.def.label.en}
            </span>
          </div>
        ) : null;

        if (entry.def.codebase) {
          const card = (
            <FileCard
              key="codebase-ref"
              name={entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || t('target.codebase')}
              path={entry.hasFiles ? t('target.codebaseDetected') : t('target.codebaseEmpty')}
              selected={entry.hasFiles}
              locked={entry.hasFiles}
              empty={!entry.hasFiles}
              emptyStyle={!entry.hasFiles ? 'amber' : undefined}
              icon={<FolderOpen className={`w-4 h-4 ${entry.hasFiles ? 'text-emerald-500' : 'text-amber-400'} shrink-0`} />}
              lang={lang}
            />
          );
          return slotLabel ? [slotLabel, card] : card;
        }

        if (!entry.hasFiles) {
          const humanName = entry.def.humanLabel?.[lang] || entry.def.humanLabel?.en || entry.def.label[lang] || entry.def.label.en;
          const showWarningStyle = showEmptyActions && entry.def.required;
          const hasCreateIntent = showEmptyActions && !!entry.def.createIntent;
          const hasPath = !!entry.def.path;
          const dirDesc = hasPath ? getDirDescription(entry.def.path) : null;

          const card = (
            <FileCard
              key={entry.def.path || entry.def.label.en}
              name={showWarningStyle ? t('emptySlot.missing', { name: humanName }) : t('emptySlot.optionalEmpty', { name: humanName, defaultValue: entry.def.label[lang] || entry.def.label.en })}
              path={hasPath ? `${entry.def.path}/` : `— ${t('emptySlot.noFiles')}`}
              description={dirDesc?.description}
              empty
              emptyStyle={showWarningStyle ? 'amber' : 'gray'}
              spotlight={hasPath ? {
                active: spotlightPath === entry.def.path,
                onClick: () => onToggleSpotlight('dir', entry.def.path),
                title: t('emptySlot.viewInExplorer'),
              } : undefined}
              actions={showEmptyActions ? (
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  {hasPath && (
                    <button
                      type="button"
                      onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                      className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
                      title={t('emptySlot.upload')}
                    >
                      <Upload className="w-4.5 h-4.5" />
                    </button>
                  )}
                </>
              ) : undefined}
              lang={lang}
            />
          );
          return slotLabel ? [slotLabel, card] : card;
        }

        const fileCards = entry.files.map(f => {
          const dirPath = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : undefined;
          return (
            <FileCard
              key={f.path}
              name={f.name}
              path={f.path}
              warnings={f.warnings}
              description={getFileDescription(f.name, dirPath)}
              selected={f.warnings.length === 0 && selected.has(f.path)}
              locked={entry.def.locked}
              onToggle={() => onToggle(f.path)}
              onViewFile={onViewFile ? () => onViewFile(f.path) : undefined}
              spotlight={{
                active: spotlightPath === f.path,
                onClick: () => onToggleSpotlight('file', f.path),
                title: t('emptySlot.viewInExplorer'),
              }}
              lang={lang}
            />
          );
        });

        if (entry.def.type === 'dir' && showEmptyActions && entry.def.path) {
          const hasCreateIntent = !!entry.def.createIntent;
          fileCards.push(
            <FileCard
              key={`${entry.def.path}-add`}
              name={t('emptySlot.addFile')}
              path={entry.def.path + '/'}
              empty
              emptyStyle="gray"
              actions={
                <>
                  {hasCreateIntent && (
                    <button
                      type="button"
                      onClick={() => onCreateIntent(entry.def.createIntent!)}
                      className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-colors"
                      title={t('emptySlot.create')}
                    >
                      <Plus className="w-4.5 h-4.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onUploadDir ? onUploadDir(entry.def.path) : onHighlightDir(entry.def.path)}
                    className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600/50 transition-colors"
                    title={t('emptySlot.upload')}
                  >
                    <Upload className="w-4.5 h-4.5" />
                  </button>
                </>
              }
              lang={lang}
            />
          );
        }

        return slotLabel ? [slotLabel, ...fileCards] : fileCards;
      })}
    </div>
  );
}
