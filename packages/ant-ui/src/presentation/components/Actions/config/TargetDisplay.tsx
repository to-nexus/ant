import { useTranslation } from 'react-i18next';
import { Lock, FolderOpen, Eye } from 'lucide-react';
import {
  type TargetDef,
  matchesOutputSpec,
  formatOutputSpec,
  getFileDescription,
  getDirDescription,
  getPatternDescription,
} from '@ant/shared';
import { FileCard } from './FileCard';
import type { SlotWarning } from './types';

interface TargetDisplayProps {
  target: TargetDef;
  selectedRefs: Set<string>;
  targetExisting: { name: string; path: string }[];
  onToggleSpotlight: (type: 'file' | 'dir', path: string) => void;
  spotlightPath?: string | null;
  onOpenIde?: () => void;
  codebaseHasFiles: boolean;
  /** When true, existing code is required (e.g. rev-code). Derived from slots having a locked codebase ref. */
  codebaseRequired: boolean;
  lang: 'en' | 'ko';
}

export function TargetDisplay({ target, selectedRefs, targetExisting, onToggleSpotlight, spotlightPath, onOpenIde, codebaseHasFiles, codebaseRequired, lang }: TargetDisplayProps) {
  const { t } = useTranslation('actions');

  switch (target.kind) {
    case 'revise': {
      if (selectedRefs.size === 0) {
        return (
          <p className="text-xs text-[color:var(--text-3)] italic px-1">
            {t('target.reviseHint')}
          </p>
        );
      }
      return (
        <div className="space-y-1.5">
          {Array.from(selectedRefs).map(p => {
            const fileName = p.split('/').pop() || p;
            const dirPath = p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : undefined;
            return (
              <FileCard
                key={p}
                name={fileName}
                path={p}
                description={getFileDescription(fileName, dirPath)}
                locked
                selected
                icon={<Lock className="w-4 h-4 text-gray-500 shrink-0" />}
                lang={lang}
              />
            );
          })}
        </div>
      );
    }

    case 'codebase': {
      const warnEmpty = codebaseRequired && !codebaseHasFiles;
      return (
        <FileCard
          name={t('target.codebase')}
          path={codebaseHasFiles ? t('target.codebaseDetected') : warnEmpty ? t('target.codebaseEmpty') : t('target.codebaseOutputReady')}
          selected={codebaseHasFiles}
          locked={codebaseHasFiles}
          empty={!codebaseHasFiles}
          emptyStyle={!codebaseHasFiles ? (warnEmpty ? 'amber' : 'gray') : undefined}
          icon={<FolderOpen className={`w-4 h-4 ${codebaseHasFiles ? 'text-emerald-500' : warnEmpty ? 'text-amber-400' : 'text-gray-400'} shrink-0`} />}
          description={{ en: 'Source code generated in the codebase/ directory.', ko: 'codebase/ 디렉터리에 생성된 소스 코드입니다.' }}
          actions={onOpenIde ? (
            <button
              type="button"
              onClick={onOpenIde}
              className="p-2 rounded-lg bg-[color:var(--bg-surface-2)]/50 text-[color:var(--text-3)] hover:bg-[color:var(--bg-active)] transition-colors"
              title={t('target.viewInIde')}
            >
              <Eye className="w-4.5 h-4.5" />
            </button>
          ) : undefined}
          lang={lang}
        />
      );
    }

    case 'generate': {
      if (target.outputs.length > 0) {
        return (
          <div className="space-y-1.5">
            {target.outputs.map(os => {
              const displayName = formatOutputSpec(os);
              const fullPath = `${target.dir}/${displayName}`;
              const hasConflict = targetExisting.some(f => matchesOutputSpec(f.name, os));
              const conflictWarning: SlotWarning | undefined = hasConflict
                ? { type: 'invalid-file', message: { en: 'May overwrite existing file', ko: '기존 파일이 덮어쓰여질 수 있습니다' } }
                : undefined;
              return (
                <FileCard
                  key={os.prefix}
                  name={displayName}
                  path={fullPath}
                  warnings={conflictWarning ? [conflictWarning] : undefined}
                  description={getPatternDescription(displayName)}
                  disabled
                  icon={<FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />}
                  spotlight={{
                    active: spotlightPath === target.dir,
                    onClick: () => onToggleSpotlight('dir', target.dir),
                    title: t('emptySlot.viewInExplorer'),
                  }}
                  lang={lang}
                />
              );
            })}
          </div>
        );
      }
      return (
        <FileCard
          name={`${target.dir}/`}
          path={t('target.willBeCreated')}
          description={getDirDescription(target.dir)?.description}
          disabled
          icon={<FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />}
          spotlight={{
            active: spotlightPath === target.dir,
            onClick: () => onToggleSpotlight('dir', target.dir),
            title: t('emptySlot.viewInExplorer'),
          }}
          lang={lang}
        />
      );
    }

    case 'chat-only':
      return (
        <p className="text-xs text-[color:var(--text-3)] italic px-1">
          {target.hint[lang] || target.hint.en}
        </p>
      );
  }
}
